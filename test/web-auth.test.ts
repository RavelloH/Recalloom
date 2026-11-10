import test from 'node:test';
import assert from 'node:assert/strict';
import {capChallenge,checkOrigin,cookie,WEB_COOKIE,session,webRateLimitEnabled} from '../src/web-auth.js';
import {deriveWebKey,webHmacHex} from '../src/web-keys.js';
import type {Env} from '../src/types.js';

test('web browser mutations require same Origin and reject cross-site Fetch Metadata',()=>{
  const request=(origin:string,site?:string)=>new Request('https://example.test/api/records',{
    method:'POST',headers:{origin,...(site?{'sec-fetch-site':site}:{})}
  });
  assert.equal(checkOrigin(request('https://example.test','same-origin')),true);
  assert.equal(checkOrigin(request('https://example.test','cross-site')),false);
  assert.equal(checkOrigin(request('https://attacker.test')),false);
  assert.equal(checkOrigin(new Request('https://example.test/api/records',{method:'POST'})),false);
});
test('web login rate limiting defaults ON and may only be disabled on loopback',()=>{
  const env=(flag?:string)=>({WEB_AUTH_RATE_LIMIT_ENABLED:flag} as Env);
  const local=new Request('http://127.0.0.1:8825/api/auth/login');
  const localhost=new Request('http://localhost:8825/api/auth/login');
  const ipv6=new Request('http://[::1]:8825/api/auth/login');
  const publicUrl=new Request('https://recalloom.example.test/api/auth/login');
  for(const flag of [undefined,'true','FALSE','0','','off']){
    assert.equal(webRateLimitEnabled(local,env(flag)),true,JSON.stringify(flag));
    assert.equal(webRateLimitEnabled(publicUrl,env(flag)),true,JSON.stringify(flag));
  }
  for(const request of [local,localhost,ipv6]){
    assert.equal(webRateLimitEnabled(request,env('false')),false,'explicit loopback-only test override');
  }
  assert.equal(webRateLimitEnabled(publicUrl,env('false')),true,'production domain must remain protected');
});
test('loopback test override skips only rate-limit DB and still requires valid Cap proof',async()=>{
  const base='http://127.0.0.1:8825';
  let rateQueries=0;
  const env={
    MCP_AUTH_SECRET:'a real local test-only oauth master key',
    WEB_AUTH_RATE_LIMIT_ENABLED:'false',
    DB:{prepare:()=>{rateQueries++;throw new Error('unexpected rate-limit DB query');}}
  } as unknown as Env;
  const request=new Request(base+'/api/auth/cap/challenge',{method:'POST',headers:{origin:base}});
  const response=await capChallenge(request,env);
  assert.equal(response.status,200,'Cap generation remains enabled');
  assert.equal(rateQueries,0,'rate-limit counter must not be read or modified');
  const payload=await response.json() as {token?:string};
  assert.equal(typeof payload.token,'string');
  const rejected=await capChallenge(new Request(base+'/api/auth/cap/challenge',{
    method:'POST',headers:{origin:'http://untrusted.example'}
  }),env);
  assert.equal(rejected.status,403,'Origin protection must remain enabled');
});
test('session cookie is HttpOnly, Secure, Strict and scoped to origin root',()=>{
  const value=cookie('test-opaque-value',Date.now()+300000);
  assert.match(value,new RegExp('^'+WEB_COOKIE+'='));
  for(const required of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age='])
    assert.ok(value.includes(required));
  assert.match(cookie('',undefined),/Max-Age=0/);
});
test('Web session hashes use OAuth-derived HMAC and are invalidated by master rotation',async()=>{
  const token='z'.repeat(43),firstSecret='a'.repeat(40),otherSecret='b'.repeat(40);
  const expected=await webHmacHex(firstSecret,'session',token);
  let lookupCount=0;
  const db={prepare:(sql:string)=>({
    bind:(hash:string)=>({
      first:async()=>{
        assert.match(sql,/revoked_at IS NULL/);
        lookupCount++;
        return hash===expected?{
          id:'session-id',created_at:Date.now()-60000,last_seen_at:Date.now()-1000,
          expires_at:Date.now()+60000,user_agent_hint:'test agent'
        }:null;
      }
    })
  })};
  const request=new Request('https://example.test/api/folders',{headers:{cookie:WEB_COOKIE+'='+token}});
  const env={MCP_AUTH_SECRET:firstSecret,DB:db} as unknown as Env;
  assert.equal((await session(request,env))?.id,'session-id');
  assert.equal(await session(request,{...env,MCP_AUTH_SECRET:otherSecret}),null);
  assert.equal(lookupCount,2);
});
test('missing OAuth master secret or invalid session token never grants access',async()=>{
  const req=new Request('https://example.test/api/folders',{headers:{cookie:WEB_COOKIE+'=bad'}});
  assert.equal(await session(req,{} as Env),null);
  assert.equal(await session(req,{MCP_AUTH_SECRET:'a'.repeat(40)} as Env),null);
});

test('server-only HMAC derivation separates Cap, proof, session, rate and nonce keys',async()=>{
  const master='a very long and random test-only oauth master key';
  const purposes=['cap','proof','session','rate','nonce'] as const;
  const derived=await Promise.all(purposes.map(p=>deriveWebKey(master,p)));
  assert.equal(new Set(derived.map(x=>Buffer.from(x).toString('hex'))).size,purposes.length);
  for(const key of derived)assert.notEqual(Buffer.from(key).toString('utf8'),master);
  assert.notDeepEqual(await deriveWebKey(master+'rotated','session'),await deriveWebKey(master,'session'));
});

test('existing OAuth master keys shorter than 32 chars can still enable Web Cap without an extra Secret',async()=>{
  const base='https://recalloom.example.test';
  const req=new Request(base+'/api/auth/cap/challenge',{method:'POST',headers:{origin:base}});
  const db={prepare:()=>({bind:()=>({first:async()=>({attempts:1})})})};
  const env={MCP_AUTH_SECRET:'existing-legacy-secret',DB:db} as unknown as Env;
  const response=await capChallenge(req,env);
  assert.equal(response.status,200);
  const body=await response.json() as {token?:string};
  assert.equal(typeof body.token,'string');
});
