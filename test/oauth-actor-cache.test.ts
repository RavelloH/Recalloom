import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberOAuthActor} from '../src/web-activity.js';
import type {Env} from '../src/types.js';

test('actor metadata lookup coalesces requests and retries failures per database',async()=>{
 let reads=0,fail=true;
 const env={DB:{prepare(){return {bind(){return {async first(){reads++;if(fail)throw Error('unavailable');return {found:1};}};}};}}} as unknown as Env;
 const id='11111111-1111-4111-8111-111111111111';
 await assert.rejects(rememberOAuthActor(env,id));
 fail=false;
 await Promise.all([rememberOAuthActor(env,id),rememberOAuthActor(env,id)]);
 await rememberOAuthActor(env,id);
 assert.equal(reads,2);
 const other={...env,DB:{...env.DB}} as Env;
 await rememberOAuthActor(other,id);
 assert.equal(reads,3,'Binding identities keep database caches separate');
});
