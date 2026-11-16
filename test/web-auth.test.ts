import test from 'node:test';
import assert from 'node:assert/strict';
import {capChallenge,checkOrigin,cookie,WEB_COOKIE,session,webRateLimitEnabled} from '../src/web-auth.js';
import {deriveWebKey,webHmacHex} from '../src/web-keys.js';
import type {Env} from '../src/types.js';
import {DatabaseSync} from 'node:sqlite';
import {mainSecret,hasMainSecret} from '../src/auth-secret.js';
import {webApi} from '../src/web-api.js';

test('MAIN_SECRET takes precedence while legacy deployments retain their effective key',()=>{
 assert.equal(mainSecret({MAIN_SECRET:'main',MCP_AUTH_SECRET:'legacy'}),'main');
 assert.equal(mainSecret({MCP_AUTH_SECRET:'legacy'}),'legacy');
 assert.equal(mainSecret({MAIN_SECRET:'',MCP_AUTH_SECRET:'legacy'}),'');
 assert.equal(hasMainSecret({MAIN_SECRET:''} as Env),false);
});

async function sessionFixture(created:number,lastSeen:number,expires:number){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE web_sessions(id TEXT,token_hash TEXT,created_at INTEGER,last_seen_at INTEGER,expires_at INTEGER,user_agent_hint TEXT,revoked_at INTEGER)');
 const secret='session policy test key',token='t'.repeat(43);
 sql.prepare('INSERT INTO web_sessions VALUES(?,?,?,?,?,?,NULL)').run('session',await webHmacHex(secret,'session',token),created,lastSeen,expires,'test');
 let writes=0;
 const DB={prepare(query:string){return {bind(...args:unknown[]){return {
  async first(){return sql.prepare(query).get(...args as never[])??null;},
  async run(){writes++;return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};}
 };}};}};
 const env={MAIN_SECRET:secret,DB} as unknown as Env;
 const request=new Request('https://example.test/api/auth/session',{headers:{cookie:WEB_COOKIE+'='+token}});
 return {sql,env,request,secret,writes:()=>writes};
}

test('web sessions slide for thirty days with hourly touches and a ninety-day cap',async t=>{
 const day=86400000,clock={now:Date.UTC(2026,10,16)};
 t.mock.method(Date,'now',()=>clock.now);
 const created=clock.now-2*day;
 const f=await sessionFixture(created,clock.now-2*3600000,created+30*day);
 let cookieExpiry=0;
 const first=await session(f.request,f.env,(_token,expires)=>{cookieExpiry=expires;});
 assert.equal(first?.expiresAt,clock.now+30*day);
 assert.equal(cookieExpiry,created+90*day);assert.equal(f.writes(),1);
 clock.now+=10*60000;
 await session(f.request,f.env);assert.equal(f.writes(),1);
 clock.now=created+89*day;
 f.sql.prepare('UPDATE web_sessions SET last_seen_at=?,expires_at=?').run(clock.now-2*3600000,created+90*day);
 assert.equal((await session(f.request,f.env))?.expiresAt,created+90*day);
 clock.now=created+90*day;assert.equal(await session(f.request,f.env),null);
 f.sql.close();
});

test('valid legacy sessions migrate, expired sessions stay expired, and variable renaming preserves hashes',async t=>{
 const day=86400000,now=Date.UTC(2026,10,16);
 t.mock.method(Date,'now',()=>now);
 const f=await sessionFixture(now-day,now-3600000,now+6*day);
 assert.equal((await session(f.request,f.env))?.expiresAt,now+30*day);
 const legacyEnv={...f.env,MAIN_SECRET:undefined,MCP_AUTH_SECRET:f.secret};
 assert.equal((await session(f.request,legacyEnv))?.id,'session');
 assert.equal(await session(f.request,{...legacyEnv,MAIN_SECRET:'different'}),null);
 f.sql.prepare('UPDATE web_sessions SET last_seen_at=?,expires_at=?').run(now-13*3600000,now+6*day);
 assert.equal(await session(f.request,f.env),null);
 f.sql.prepare('UPDATE web_sessions SET created_at=?,last_seen_at=?,expires_at=?').run(now-45*day,now-30*day,now+day);
 assert.equal(await session(f.request,f.env),null);
 f.sql.prepare('UPDATE web_sessions SET last_seen_at=?,revoked_at=?').run(now,now);
 assert.equal(await session(f.request,f.env),null);
 f.sql.close();
});

test('logout cookie overrides a simultaneous legacy-session renewal',async t=>{
 const day=86400000,now=Date.UTC(2026,10,16);
 t.mock.method(Date,'now',()=>now);
 const f=await sessionFixture(now-day,now-3600000,now+6*day);
 const response=await webApi.fetch(new Request('https://example.test/api/auth/logout',{
  method:'POST',headers:{origin:'https://example.test',cookie:f.request.headers.get('cookie')!}
 }),f.env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('set-cookie')??'',/Max-Age=0/);
 assert.ok(f.sql.prepare('SELECT revoked_at FROM web_sessions').get()!.revoked_at);
 f.sql.close();
});

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
      run:async()=>({meta:{changes:1}}),
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
