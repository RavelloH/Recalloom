import test from 'node:test';
import assert from 'node:assert/strict';
import {recentUpdates} from '../src/web-recent-updates.js';
import type {Env} from '../src/types.js';

test('recent updates queries only current content revisions, excluding archived and metadata-only changes',async()=>{
 let sql='',size=0;
 const rows=[
  {id:'b',name:'文档B.md',kind:'document',revision:4,updatedAt:'2026-11-13T04:00:00.000Z',actorName:'本人（Web）'},
  {id:'a',name:'任务清单',kind:'task_list',revision:2,updatedAt:'2026-11-13T03:00:00.000Z',actorName:'Claude Code'}
 ];
 const env={DB:{prepare:(query:string)=>{sql=query;return {bind:(limit:number)=>{size=limit;return {all:async()=>({results:rows})};}};}}} as unknown as Env;
 const result=await recentUpdates(env,8);
 assert.equal(size,8);
 assert.deepEqual(result.items,rows);
 assert.match(sql,/JOIN record_contents c ON c\.record_id=v\.record_id AND c\.revision=v\.revision/);
 assert.match(sql,/r\.status!='archived'/);
 assert.match(sql,/r\.kind IN \('document','task_list'\)/);
 assert.match(sql,/ORDER BY v\.created_at DESC/);
 assert.match(sql,/LEFT JOIN oauth_actor_names/);
 await recentUpdates(env,999);
 assert.equal(size,30,'limit is bounded for a lightweight home query');
});
