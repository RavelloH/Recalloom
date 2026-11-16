import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createRecalloomServer} from '../src/mcp.js';
import {handleMcpRequest,MCP_MAX_REQUEST_BODY_SIZE} from '../src/mcp-http.js';
import type {Env} from '../src/types.js';

function request(body:string,version='2026-07-28'){
 return new Request('https://recalloom.test/mcp',{method:'POST',headers:{
  'content-type':'application/json',accept:'application/json, text/event-stream',
  'MCP-Protocol-Version':version,'Mcp-Method':'tools/call','Mcp-Name':'get_help'
 },body});
}
const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_help',arguments:{},_meta:{
 'io.modelcontextprotocol/protocolVersion':'2026-07-28',
 'io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'stream-test',version:'1'}
}}});

test('modern MCP executes through SDK validation without cloning the request',async()=>{
 const handler=createMcpHandler(()=>createRecalloomServer({} as Env,['notes:read'],'stream-test',undefined,'get_help'));
 const input=request(body);
 Object.defineProperty(input,'clone',{value(){throw Error('Unexpected stream clone');}});
 const response=await handleMcpRequest(handler,input);
 assert.equal(response.status,200);
 assert.equal((await response.json() as any).result.structuredContent.result.topic,'index');
 const invalid=await handleMcpRequest(handler,request(body.replace('"arguments":{}','"arguments":{"kind":"inline"}')));
 assert.match(JSON.stringify(await invalid.json()),/kind requires component/);
 const mismatched=request(body);
 mismatched.headers.set('Mcp-Name','search');
 assert.equal((await handleMcpRequest(handler,mismatched)).status,400);
 await handler.close();
});

test('modern MCP rejects malformed and oversized bodies before dispatch',async()=>{
 const handler=createMcpHandler(()=>{throw Error('Must not dispatch');});
 assert.equal((await handleMcpRequest(handler,request('{'))).status,400);
 assert.equal((await handleMcpRequest(handler,request(' '.repeat(MCP_MAX_REQUEST_BODY_SIZE+1)))).status,413);
 await handler.close();
});

test('legacy MCP initialization keeps the SDK stream handling path',async()=>{
 const handler=createMcpHandler(()=>createRecalloomServer({} as Env,['notes:read']));
 const input=request(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'legacy',version:'1'}}}),'2025-06-18');
 const response=await handleMcpRequest(handler,input);
 assert.equal(response.status,200);assert.match(await response.text(),/serverInfo/);
 await handler.close();
});
