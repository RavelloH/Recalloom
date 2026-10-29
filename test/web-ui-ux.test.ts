import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightedSegments} from '../web/src/highlight.js';
import {recentActivity,rememberOAuthActor} from '../src/web-activity.js';
import type {Env} from '../src/types.js';

test('literal highlighting preserves original text and only marks true matches',()=>{
 const p=highlightedSegments('Recalloom records RECALLOOM','recalloom');
 assert.deepEqual(p.map(v=>v.matched),[true,false,true]);
 assert.equal(p.map(v=>v.text).join(''),'Recalloom records RECALLOOM');
 assert.deepEqual(highlightedSegments('semantic similarity','unrelated'),[{text:'semantic similarity',matched:false}]);
 assert.deepEqual(highlightedSegments('你好世界 你好','你好').filter(v=>v.matched).map(v=>v.text),['你好','你好']);
});

test('recent activity is newest-first and enriches resource/actor from persisted OAuth registration',async()=>{
 let sql='';const env={DB:{prepare:(q:string)=>{sql=q;return {bind:()=>({all:async()=>({results:[{seq:9,revision:3,actor:'grant:agent-uuid',createdAt:'2026-10-29T00:00:00Z',recordId:'r1',operation:'update',entityType:'record',entityId:'r1',detailsJson:'{}',recordName:'Design.md',folderName:null,clientName:'Codex'},{seq:8,revision:1,actor:'web:owner:x',createdAt:'2026-10-28T00:00:00Z',recordId:null,operation:'create',entityType:'folder',entityId:'f1',detailsJson:'{\"name\":\"Work\"}',recordName:null,folderName:'Work',clientName:null}]})})};}}} as unknown as Env;
 const output=await recentActivity(env,undefined,20);
 assert.match(sql,/ORDER BY e.seq DESC/);
 assert.equal(output.items[0]?.actorName,'Codex');
 assert.equal(output.items[0]?.resourceName,'Design.md');
 assert.equal(output.items[1]?.actorName,'本人（Web）');
 assert.equal(output.items[1]?.resourceName,'Work');
 assert.deepEqual(output.items.map(x=>x.seq),[9,8]);
});

test('legacy OAuth actor is named when its registered client next uses MCP',async()=>{
 let saved:{name?:string;id?:string}={};
 const env={DB:{prepare:(sql:string)=>({bind:(...args:unknown[])=>({first:async()=>null,run:async()=>{if(sql.includes('INSERT')){saved={id:String(args[0]),name:String(args[1])};}return {};}})})},OAUTH_PROVIDER:{listClients:async()=>({items:[{clientId:'my-client',clientName:'Claude Code'}]})}} as unknown as Env;
 await rememberOAuthActor(env,'dcedada0-f030-4070-8da6-92cd74178c0b','my-client');
 assert.deepEqual(saved,{id:'dcedada0-f030-4070-8da6-92cd74178c0b',name:'Claude Code'});
});
