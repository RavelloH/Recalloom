import OAuthProvider, { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createRecalloomServer } from './mcp.js';
import { processIndexJobs } from './search.js';
import { webApi } from './web-api.js';
import { cleanupWebAuth } from './web-auth.js';
import { rememberOAuthActor } from './web-activity.js';
import type { Env } from './types.js';
import { page, escapeHtml, consentForm } from './auth-page.js';

const SCOPES=['notes:read','notes:write'];

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
        consentForm(request, details.clientName, details.redirectHost, consent.handle, scope),
        200,
        callbackOrigin
      );
      consent.headers.forEach((value,key)=>res.headers.append(key,value));
      return res;
    }
    const form=await request.formData();
    const handle=String(form.get('handle')??'');
    if(!handle)return page('授权已失效','<h1>授权已失效</h1><p>请从客户端重新开始连接。</p>',400);
    if(form.get('decision')!=='approve'){
      const denied=await oauth.denyConsent(request,handle);
      return new Response(null,{status:302,headers:denied.headers});
    }
    const supplied=String(form.get('secret')??'');
    if(!safeEqual(supplied,env.MCP_AUTH_SECRET)){
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const scopes = details.scope.length ? details.scope : SCOPES;
      return page(
        '授权密钥不正确',
        consentForm(request, details.clientName, details.redirectHost, handle, scopes, '授权密钥不正确，请重试或取消。'),
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
    approved.headers.set('location',redirectTo);
    return new Response(null,{status:302,headers:approved.headers});
  }catch(e){
    if(e instanceof AuthorizationError){
      if(e.redirectTo)return Response.redirect(e.redirectTo,302);
      return page('授权失败','<h1>授权错误</h1><p>'+escapeHtml(e.description)+'</p>',400);
    }
    throw e;
  }
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
    requiredScopes:SCOPES,
    resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin],resource_name:'Recalloom'},
    // Keep DCR for ChatGPT/Codex: Cloudflare Worker fetches of chatgpt.com CIMD JSON
    // currently return HTTP 403, even though a browser fetch may return 200.
    // Enabling CIMD here makes these clients prefer a failing authorization path.
    // Re-evaluate when upstream Worker-to-ChatGPT metadata fetching is fixed.
    clientIdMetadataDocumentEnabled:false,
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
