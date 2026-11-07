import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { createRecalloomServer } from '../src/mcp.js';
import { SERVER_INSTRUCTIONS, TOOL_GUIDANCE } from '../src/mcp-guidance.js';
import {getHelp,HELP_TOPICS} from '../src/help/index.js';
import type { Env } from '../src/types.js';

type ResultMessage={jsonrpc:string;id:number;result?:any;error?:any};
test('MCP initialize advertises server usage instructions and tools/list exposes all guidance',async()=>{
  const mcp=createRecalloomServer({} as Env,['notes:read','notes:write'],'guidance-test');
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  const pending=new Map<number,{resolve:(x:ResultMessage)=>void;reject:(e:Error)=>void}>();
  clientTransport.onmessage=(message)=>{
    if('id' in message && typeof message.id==='number'){
      const p=pending.get(message.id);
      if(p){pending.delete(message.id);p.resolve(message as ResultMessage);}
    }
  };
  await mcp.connect(serverTransport);
  await clientTransport.start();
  let nextId=0;
  const request=async(method:string,params:Record<string,unknown>)=>{
    const id=++nextId;
    const response=new Promise<ResultMessage>((resolve,reject)=>pending.set(id,{resolve,reject}));
    await clientTransport.send({jsonrpc:'2.0',id,method,params});
    const value=await response;
    assert.equal(value.error,undefined,method+' should succeed: '+JSON.stringify(value.error));
    return value.result;
  };
  try {
    const init=await request('initialize',{
      protocolVersion:LATEST_PROTOCOL_VERSION,
      capabilities:{},
      clientInfo:{name:'recalloom-guidance-test',version:'0.0.1'}
    });
    assert.equal(init.instructions,SERVER_INSTRUCTIONS);
    assert.match(init.instructions,/expectedRevision/);
    assert.match(init.instructions,/get_overview/);
    await clientTransport.send({jsonrpc:'2.0',method:'notifications/initialized'});
    const result=await request('tools/list',{});
    const tools=result.tools as Array<{name:string;title:string;description:string;inputSchema:{properties?:Record<string,{description?:string}>;required?:string[]};annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean}}>;
    assert.equal(tools.length,Object.keys(TOOL_GUIDANCE).length);
    assert.deepEqual(new Set(tools.map(t=>t.name)),new Set(Object.keys(TOOL_GUIDANCE)));
    for(const tool of tools){
      const guidance=TOOL_GUIDANCE[tool.name as keyof typeof TOOL_GUIDANCE];
      assert.equal(tool.title,guidance.title);
      assert.equal(tool.description,guidance.description);
      assert.equal(tool.annotations?.destructiveHint,guidance.destructive);
    }
    const resources=await request('resources/list',{});
    assert.equal(resources.resources.length,HELP_TOPICS.length+1);
    const expectedUris=['recalloom://help/index',...HELP_TOPICS.map(x=>'recalloom://help/'+x)];
    assert.deepEqual(new Set(resources.resources.map((x:{uri:string})=>x.uri)),new Set(expectedUris));
    const read=await request('resources/read',{uri:'recalloom://help/math'});
    assert.deepEqual(read.contents,[{
      uri:'recalloom://help/math',
      mimeType:'text/markdown',
      text:getHelp('math').content
    }]);
    const viaTool=await request('tools/call',{name:'get_help',arguments:{topic:'math'}});
    assert.equal(viaTool.isError,undefined);
    const helpFromTool=JSON.parse(viaTool.content[0].text);
    assert.equal(helpFromTool.content,read.contents[0].text);
    assert.match(helpFromTool.contentHash,/^[0-9a-f]{64}$/);
    assert.match(helpFromTool.helpVersion,/^1\.[0-9a-f]{12}$/);
    assert.equal(helpFromTool.schemaVersion,1);
    const indexResource=await request('resources/read',{uri:'recalloom://help/index'});
    assert.ok(indexResource.contents[0].text.includes(helpFromTool.contentHash));
    const index=await request('tools/call',{name:'get_help',arguments:{}});
    assert.equal(JSON.parse(index.content[0].text).topic,'index');
    const invalid=await request('tools/call',{name:'get_help',arguments:{topic:'unknown'}});
    assert.equal(invalid.isError,true,'unknown topic should fail validation');
    const tool=(name:string)=>{
      const t=tools.find(t=>t.name===name);
      assert.ok(t,'expected '+name);
      return t;
    };
    assert.match(tool('get_help').description,/KaTeX/);
    for(const name of ['manage_record','manage_folder']){
      assert.ok(tool(name).inputSchema.required?.includes('expectedMetadataRevision'),name+' requires revision');
      const missing=await request('tools/call',{name,arguments:{id:'11111111-1111-4111-8111-111111111111',name:'Updated'}});
      assert.equal(missing.isError,true);
      // The MCP SDK validates the input schema before calling our handler.
      assert.match(missing.content[0].text,/expectedMetadataRevision/);
    }
    assert.match(tool('browse').inputSchema.properties?.cursor?.description??'',/page\.nextCursor/);
    assert.match(tool('edit_record').inputSchema.properties?.expectedRevision?.description??'',/concurrent/);
    assert.match(tool('import_snapshot').inputSchema.properties?.bundle?.description??'',/snapshot-v2/);
    assert.match(tool('read_many').inputSchema.properties?.maxChars?.description??'',/budget/);
    assert.match(tool('export_snapshot').description,/snapshot-v2/);
    assert.match(tool('import_snapshot').description,/complete/);
    assert.ok(tool('get_overview').description.includes('folder'));
    assert.ok(tool('get_outline').description.includes('heading'));
    assert.equal(tool('get_outline').annotations?.readOnlyHint,true);
    assert.equal(tool('related_records').annotations?.readOnlyHint,true);
    assert.equal(tool('get_knowledge_graph').annotations?.readOnlyHint,true);
    assert.match(tool('related_records').description,/semantic candidates/);
    assert.equal(tool('mutate_task').annotations?.destructiveHint,true);
    assert.equal(tool('manage_record').annotations?.destructiveHint,true);
    assert.equal(tool('index_pending').annotations?.destructiveHint,false);
    assert.equal(tool('read_record').annotations?.readOnlyHint,true);
    assert.equal(tool('export_snapshot').annotations?.readOnlyHint,true);
  } finally {
    await mcp.close();
    await clientTransport.close();
  }
});
