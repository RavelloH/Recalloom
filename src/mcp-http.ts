import {readRequestBody,type McpHttpHandler} from '@modelcontextprotocol/server';

// Preserve the SDK's existing 4 MiB limit for both serving paths.
export const MCP_MAX_REQUEST_BODY_SIZE=4*1024*1024;

function parseError(message:string,status=400,code=-32700){
 return Response.json({jsonrpc:'2.0',error:{code,message},id:null},{status});
}

/** Supply the SDK's parsedBody escape hatch without teeing modern request streams. */
export async function handleMcpRequest(handler:McpHttpHandler,request:Request){
 const contentType=request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
 if(request.method!=='POST'||request.headers.get('MCP-Protocol-Version')!=='2026-07-28'||contentType!=='application/json')return handler.fetch(request);
 let body;
 try{body=await readRequestBody(request,MCP_MAX_REQUEST_BODY_SIZE);}
 catch{return parseError('Parse error: the request body could not be read');}
 if(body.tooLarge)return parseError(`Payload Too Large: Request body must not exceed ${MCP_MAX_REQUEST_BODY_SIZE} bytes`,413,-32000);
 let parsedBody:unknown;
 try{parsedBody=JSON.parse(body.text);}
 catch{return parseError('Parse error: the request body is not valid JSON');}
 return handler.fetch(request,{parsedBody});
}
