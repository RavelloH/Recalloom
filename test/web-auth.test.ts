import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOrigin,cookie,WEB_COOKIE,session,sha} from '../src/web-auth.js';
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
test('session cookie is HttpOnly, Secure, Strict and scoped to origin root',()=>{
  const value=cookie('test-opaque-value',Date.now()+300000);
  assert.match(value,new RegExp('^'+WEB_COOKIE+'='));
  for(const required of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age='])
    assert.ok(value.includes(required));
  assert.match(cookie('',undefined),/Max-Age=0/);
});
test('Web session hashes are bound to admin secret, invalidated by secret rotation',async()=>{
  const token='z'.repeat(43),firstSecret='a'.repeat(40),otherSecret='b'.repeat(40);
  const expected=await sha('recalloom:session:v1:'+firstSecret+':'+token);
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
  const env={WEB_ADMIN_SECRET:firstSecret,DB:db} as unknown as Env;
  assert.equal((await session(request,env))?.id,'session-id');
  assert.equal(await session(request,{...env,WEB_ADMIN_SECRET:otherSecret}),null);
  assert.equal(lookupCount,2);
});
test('missing web secret or invalid session token never grants access',async()=>{
  const req=new Request('https://example.test/api/folders',{headers:{cookie:WEB_COOKIE+'=bad'}});
  assert.equal(await session(req,{} as Env),null);
  assert.equal(await session(req,{WEB_ADMIN_SECRET:'a'.repeat(40)} as Env),null);
});
