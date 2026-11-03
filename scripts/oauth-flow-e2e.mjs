import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const base = process.env.RECALLOOM_TEST_BASE || 'http://127.0.0.1:8897';
const secret = process.env.RECALLOOM_TEST_SECRET || 'recalloom-local-web-test-secret-32-bytes-only';
const callback = 'http://127.0.0.1:7365/oauth/callback';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function request(path, init={}) {
  const res = await fetch(new URL(path,base),{redirect:'manual',...init});
  const body = await res.text();
  let data;
  try { data=JSON.parse(body); } catch { data=body; }
  return { status:res.status, headers:res.headers, data, body };
}
const json = (path,data) => request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const formPost = (path,data,headers={}) => request(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:data instanceof URLSearchParams?data:new URLSearchParams(data)});
function status(res,expected,label) { assert.equal(res.status,expected,label+': '+String(res.body).slice(0,800)); }
async function main(){
  const server=await request('/.well-known/oauth-authorization-server');
  status(server,200,'OAuth metadata');
  assert.equal(server.data.client_id_metadata_document_supported,true,'CIMD must be advertised');
  assert.equal(server.data.registration_endpoint,base+'/oauth/register','DCR retained');
  assert.equal(server.data.token_endpoint,base+'/oauth/token');
  const resource=await request('/.well-known/oauth-protected-resource/mcp');
  status(resource,200,'MCP resource discovery');
  assert.equal(resource.data.resource,base+'/mcp');
  const unauth=await request('/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'e2e',version:'1.0'}}})});
  assert.equal(unauth.status,401,'unauthenticated MCP must require OAuth');
  assert.match(unauth.headers.get('www-authenticate')??'',/Bearer/i);

  const dcr=await json('/oauth/register',{
    client_name:'Recalloom OAuth isolated E2E',
    redirect_uris:[callback],
    grant_types:['authorization_code','refresh_token'],
    response_types:['code'],
    token_endpoint_auth_method:'none'
  });
  status(dcr,201,'register public PKCE client');
  const clientId=dcr.data.client_id;
  assert.ok(clientId);
  const url=new URL('/authorize',base);
  for(const [k,v] of Object.entries({
    client_id:clientId,redirect_uri:callback,response_type:'code',
    scope:'notes:read notes:write',resource:base+'/mcp',
    code_challenge:challenge,code_challenge_method:'S256',state:'recalloom-oauth-e2e'
  }))url.searchParams.set(k,v);
  const path=url.pathname+url.search;
  const consent=await request(path);
  status(consent,200,'show consent');
  const handle=/<input type="hidden" name="handle" value="([^"]+)"/.exec(consent.body)?.[1];
  assert.ok(handle,'consent transaction handle present');
  const cookie=(consent.headers.get('set-cookie')??'').split(';')[0];
  const headers={'cookie':cookie,'origin':base};
  const bad=await formPost(path,{handle,secret:'bad e2e password',decision:'approve','scope':'notes:read'},headers);
  status(bad,401,'bad secret rejected');
  assert.match(bad.body,/授权密钥不正确/);
  const allowed=await formPost(path,new URLSearchParams([['handle',handle],['secret',secret],['decision','approve'],['scope','notes:read'],['scope','notes:write']]),headers);
  status(allowed,302,'complete authorization');
  const redirect=new URL(allowed.headers.get('location')??'');
  assert.equal(redirect.origin,new URL(callback).origin);
  assert.equal(redirect.searchParams.get('state'),'recalloom-oauth-e2e');
  const code=redirect.searchParams.get('code');
  assert.ok(code);
  const token=await formPost('/oauth/token',{
    grant_type:'authorization_code',client_id:clientId,redirect_uri:callback,
    code,code_verifier:verifier,resource:base+'/mcp'
  });
  status(token,200,'exchange PKCE authorization code');
  assert.ok(token.data.access_token);
  assert.ok(token.data.refresh_token);
  const mcp=await request('/mcp',{
    method:'POST',
    headers:{'authorization':'Bearer '+token.data.access_token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'recalloom-oauth-e2e',version:'1.0'}}})
  });
  status(mcp,200,'authorized MCP initialize');
  assert.match(mcp.body,/protocolVersion|serverInfo|result/);
  const refresh=await formPost('/oauth/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:token.data.refresh_token,resource:base+'/mcp'});
  status(refresh,200,'refresh OAuth token');
  assert.ok(refresh.data.access_token);
  // Replay may revoke the related grant as a theft-detection measure; check it last.
  const replay=await formPost('/oauth/token',{grant_type:'authorization_code',client_id:clientId,redirect_uri:callback,code,code_verifier:verifier,resource:base+'/mcp'});
  assert.equal(replay.status,400,'authorization code cannot be reused');
  // A read-only grant must access MCP without being forced to request write scope.
  const readClient=await json('/oauth/register',{
    client_name:'Recalloom read-only E2E',
    redirect_uris:[callback],
    grant_types:['authorization_code','refresh_token'],
    response_types:['code'],
    token_endpoint_auth_method:'none'
  });
  status(readClient,201,'register read-only client');
  const readUrl=new URL('/authorize',base);
  for(const [key,value] of Object.entries({
    client_id:readClient.data.client_id,redirect_uri:callback,response_type:'code',
    scope:'notes:read',resource:base+'/mcp',
    code_challenge:challenge,code_challenge_method:'S256',state:'read-only-e2e'
  }))readUrl.searchParams.set(key,value);
  const readPath=readUrl.pathname+readUrl.search;
  const readConsent=await request(readPath);
  status(readConsent,200,'read-only consent');
  const readHandle=/<input type="hidden" name="handle" value="([^"]+)"/.exec(readConsent.body)?.[1];
  assert.ok(readHandle);
  const readApproval=await formPost(readPath,{
    handle:readHandle,secret,decision:'approve',scope:'notes:read'
  },{cookie:(readConsent.headers.get('set-cookie')??'').split(';')[0],origin:base});
  status(readApproval,302,'approve read-only client');
  const readCode=new URL(readApproval.headers.get('location')??'').searchParams.get('code');
  assert.ok(readCode);
  const readToken=await formPost('/oauth/token',{
    grant_type:'authorization_code',client_id:readClient.data.client_id,
    redirect_uri:callback,code:readCode,code_verifier:verifier,resource:base+'/mcp'
  });
  status(readToken,200,'exchange read-only token');
  const readMcpHeaders={
    authorization:'Bearer '+readToken.data.access_token,
    'content-type':'application/json',
    accept:'application/json, text/event-stream',
    'mcp-protocol-version':'2025-06-18'
  };
  const readInit=await request('/mcp',{
    method:'POST',headers:readMcpHeaders,
    body:JSON.stringify({jsonrpc:'2.0',id:2,method:'initialize',params:{
      protocolVersion:'2025-06-18',capabilities:{},
      clientInfo:{name:'read-only-e2e',version:'1.0'}
    }})
  });
  status(readInit,200,'read-only MCP initializes');
  const blockedWrite=await request('/mcp',{
    method:'POST',headers:readMcpHeaders,
    body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{
      name:'create_folder',arguments:{name:'read-only-cannot-write'}
    }})
  });
  status(blockedWrite,200,'write tool returns structured MCP error');
  assert.match(blockedWrite.body,/INSUFFICIENT_SCOPE/,'read-only OAuth scope must block writes');
  // Rate-limit invalid secrets without affecting a successful distinct source.
  // Local tests can choose an isolated synthetic CF source address.
  const limitedHeaders={
    cookie:(readConsent.headers.get('set-cookie')??'').split(';')[0],
    origin:base,'cf-connecting-ip':'2001:db8::'+randomBytes(2).toString('hex')
  };
  for(let i=0;i<8;i++){
    const rejected=await formPost(readPath,{
      handle:readHandle,secret:'invalid-password-'+i,decision:'approve',scope:'notes:read'
    },limitedHeaders);
    status(rejected,401,'invalid secret attempt '+(i+1));
  }
  const locked=await formPost(readPath,{
    handle:readHandle,secret:'invalid-password-9',decision:'approve',scope:'notes:read'
  },limitedHeaders);
  status(locked,429,'OAuth secret rate limit');
  console.log('PASS isolated OAuth E2E: discovery, DCR, consent, bad secret, PKCE, token, MCP, replay, refresh, read-only scope, write guard and rate limiting');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
