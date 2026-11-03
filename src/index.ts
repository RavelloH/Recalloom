import OAuthProvider, { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createRecalloomServer } from './mcp.js';
import { processIndexJobs } from './search.js';
import { webApi } from './web-api.js';
import { cleanupWebAuth } from './web-auth.js';
import { rememberOAuthActor } from './web-activity.js';
import type { Env } from './types.js';
import { page, escapeHtml, consentForm } from './auth-page.js';

const SCOPES=['notes:read','notes:write'];
const MAX_AUTH_FAILURES=8;
const AUTH_FAILURE_TTL=3600;

async function rateLimitKey(request:Request):Promise<string>{
  // Hash the client IP rather than storing it in OAuth KV.
  const ip=request.headers.get('cf-connecting-ip')??'unknown';
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)));
  const value=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return 'recalloom:auth-fail:'+value;
}

function oauthErrorResponse(error:unknown):Response{
  if(error instanceof AuthorizationError){
    if(error.redirectTo)return Response.redirect(error.redirectTo,302);
    return page('授权失败','<h1>授权错误</h1><p>'+escapeHtml(error.description)+'</p>',400);
  }
  if(error instanceof CimdFetchError){
    // Metadata can be unreachable from Cloudflare even when it opens in a browser.
    // Never bypass CIMD validation or silently trust an unverified client.
    const response=page('客户端暂时不可验证',
      '<h1>客户端元数据暂时不可用</h1><p>请稍后重试，或让客户端使用动态客户端注册（DCR）重新连接。</p>',503);
    response.headers.set('retry-after','30');
    return response;
  }
  throw error;
}

function safeEqual(a:string,b:string):boolean{
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  let mismatch=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)mismatch|=(x[i]??0)^(y[i]??0);
  return mismatch===0;
}
async function authorize(request:Request,env:Env):Promise<Response>{
  if(request.method!=='GET'&&request.method!=='POST')return new Response('Method not allowed',{status:405});
  if(!env.MCP_AUTH_SECRET||env.MCP_AUTH_SECRET==='replace-with-a-random-secret')return new Response('MCP_AUTH_SECRET is not configured',{status:503});
  const oauth=env.OAUTH_PROVIDER;
  try{
    if(request.method==='GET'){
      const parsed=await oauth.parseAuthRequest(request);
      const details=await oauth.describeConsent(parsed);
      const consent=await oauth.beginConsent(parsed);
      const scope=details.scope.length?details.scope:SCOPES;
      const callbackOrigin = new URL(parsed.redirectUri).origin;
      const res = page(
        'Recalloom OAuth',
        consentForm(request, details.clientName, details.redirectHost, consent.handle, scope, '', details.clientDomain, details.redirectIsLoopback),
        200,
        callbackOrigin
      );
      consent.headers.forEach((value,key)=>res.headers.append(key,value));
      return res;
    }
    const declaredLength=Number(request.headers.get('content-length')??0);
    if(declaredLength>8192)return page('授权失败','<h1>授权表单过大</h1>',413);
    const rawBody=await request.text();
    if(new TextEncoder().encode(rawBody).length>8192)return page('授权失败','<h1>授权表单过大</h1>',413);
    if(!(request.headers.get('content-type')??'').startsWith('application/x-www-form-urlencoded'))
      return page('授权失败','<h1>授权表单格式不正确</h1>',400);
    const form=new URLSearchParams(rawBody);
    const handle=String(form.get('handle')??'');
    if(!handle)return page('授权已失效','<h1>授权已失效</h1><p>请从客户端重新开始连接。</p>',400);
    if(form.get('decision')!=='approve'){
      const denied=await oauth.denyConsent(request,handle);
      return new Response(null,{status:302,headers:denied.headers});
    }
    const attemptsKey=await rateLimitKey(request);
    const attempts=Number(await env.OAUTH_KV.get(attemptsKey)??'0');
    if(attempts>=MAX_AUTH_FAILURES)return page('授权已暂停','<h1>尝试次数过多</h1><p>请稍后重新发起授权。</p>',429);
    const supplied=String(form.get('secret')??'');
    if(!safeEqual(supplied,env.MCP_AUTH_SECRET)){
      await env.OAUTH_KV.put(attemptsKey,String(attempts+1),{expirationTtl:AUTH_FAILURE_TTL});
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const scopes = details.scope.length ? details.scope : SCOPES;
      return page(
        '授权密钥不正确',
        consentForm(request, details.clientName, details.redirectHost, handle, scopes, '授权密钥不正确，请重试或取消。', details.clientDomain, details.redirectIsLoopback),
        401,
        new URL(parsed.redirectUri).origin
      );
    }
    const details=await oauth.describeConsent(await oauth.parseAuthRequest(request));
    const approved=await oauth.approveConsent(request,handle,{scope:form.getAll('scope').map(String)});
    const actorId=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO oauth_actor_names(actor_id,client_name,created_at) VALUES(?,?,?)')
      .bind(actorId,details.clientName.trim().slice(0,200)||'Unnamed Agent',new Date().toISOString()).run();
    const {redirectTo}=await oauth.completeAuthorization({
      request:approved.request,userId:'owner',metadata:{},scope:approved.request.scope,
      props:{actorId,clientName:details.clientName.trim().slice(0,200)}
    });
    await env.OAUTH_KV.delete(attemptsKey);
    approved.headers.set('location',redirectTo);
    return new Response(null,{status:302,headers:approved.headers});
  }catch(e){return oauthErrorResponse(e);}
}
function provider(env:Env,request:Request){
  const origin=env.MCP_BASE_URL?new URL(env.MCP_BASE_URL).origin:new URL(request.url).origin;
  return new OAuthProvider<Env>({
    apiRoute:'/mcp',
    apiHandler:{
      async fetch(mcpRequest:Request,requestEnv:Env,ctx:ExecutionContext & {props?:unknown;auth?:{scope?:string[];clientId?:string}}){
        if(new URL(mcpRequest.url).pathname!=='/mcp')return new Response('Not Found',{status:404});
        const scopes=ctx.auth?.scope??[];
        if(!scopes.includes('notes:read'))return Response.json({error:'insufficient_scope'},{status:403});
        const props=ctx.props&&typeof ctx.props==='object'?ctx.props as {actorId?:string;clientName?:string}:{};
        if(props.actorId)ctx.waitUntil(rememberOAuthActor(requestEnv,props.actorId,ctx.auth?.clientId,props.clientName).catch(e=>console.error('Agent name sync failed',e)));
        const handler=createMcpHandler(()=>createRecalloomServer(requestEnv,scopes,'grant:'+String(props.actorId??'unknown')),{legacy:'stateless'});
        return handler.fetch(mcpRequest);
      }
    },
    defaultHandler:{
      fetch(req:Request,e:Env){
        const path=new URL(req.url).pathname;
        if(path.startsWith('/api/'))return webApi.fetch(req,e);
        if(path==='/authorize')return authorize(req,e);
        if(path==='/health'||path==='/')return Response.json({name:'Recalloom',version:'0.1.0',mcp:origin+'/mcp',status:'production'},{headers:{'cache-control':'no-store'}});
        return new Response('Not Found',{status:404});
      }
    },
    authorizeEndpoint:'/authorize',
    tokenEndpoint:'/oauth/token',
    clientRegistrationEndpoint:'/oauth/register',
    scopesSupported:SCOPES,
    // All MCP sessions need read access; write permission is checked per tool.
    // Requiring both scopes here incorrectly rejects read-only OAuth grants.
    requiredScopes:['notes:read'],
    resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin],resource_name:'Recalloom'},
    // Match cf-browser-mcp: support both Client ID Metadata Documents and DCR.
    // Some CIMD origins (including ChatGPT) can block Cloudflare egress (HTTP 403).
    // Fail closed with a recoverable 503 on metadata errors; DCR remains available.
    clientIdMetadataDocumentEnabled:true,
    refreshTokenTTL:90*24*3600,
    refreshTokenIdleTTL:30*24*3600
  });
}
export default {
  fetch(request:Request,env:Env,ctx:ExecutionContext){
    return provider(env,request).fetch(request,env,ctx);
  },
  scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(processIndexJobs(env,5).then(x=>console.log('Recalloom indexing',JSON.stringify(x))).catch(e=>console.error('Recalloom indexing failed',e)));
    ctx.waitUntil(cleanupWebAuth(env).catch(e=>console.error('Recalloom Web auth cleanup failed',e)));
  }
} satisfies ExportedHandler<Env>;
