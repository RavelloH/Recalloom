import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightedSegments} from '../web/src/highlight.js';
import {rememberOAuthActor} from '../src/web-activity.js';
import type {Env} from '../src/types.js';

test('literal highlighting preserves original text and only marks true matches',()=>{
 const p=highlightedSegments('Recalloom records RECALLOOM','recalloom');
 assert.deepEqual(p.map(v=>v.matched),[true,false,true]);
 assert.equal(p.map(v=>v.text).join(''),'Recalloom records RECALLOOM');
 assert.deepEqual(highlightedSegments('semantic similarity','unrelated'),[{text:'semantic similarity',matched:false}]);
 assert.deepEqual(highlightedSegments('你好世界 你好','你好').filter(v=>v.matched).map(v=>v.text),['你好','你好']);
});

test('legacy OAuth actor is named when its registered client next uses MCP',async()=>{
 let saved:{name?:string;id?:string}={};
 const env={DB:{prepare:(sql:string)=>({bind:(...args:unknown[])=>({first:async()=>null,run:async()=>{if(sql.includes('INSERT')){saved={id:String(args[0]),name:String(args[1])};}return {};}})})},OAUTH_PROVIDER:{listClients:async()=>({items:[{clientId:'my-client',clientName:'Claude Code'}]})}} as unknown as Env;
 await rememberOAuthActor(env,'dcedada0-f030-4070-8da6-92cd74178c0b','my-client');
 assert.deepEqual(saved,{id:'dcedada0-f030-4070-8da6-92cd74178c0b',name:'Claude Code'});
});
