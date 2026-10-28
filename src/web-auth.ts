import { generateChallenge, validateChallenge } from 'capjs-core';
import type { Env } from './types.js';
import { bytesToHex,deriveWebKey,webCryptoKey,webHmacHex } from './web-keys.js';

const utf8=new TextEncoder();
const CAP_TTL=120_000, SESSION_ABSOLUTE=7*24*3600_000, SESSION_IDLE=12*3600_000;
export const WEB_COOKIE='__Host-recalloom_session';
const b64=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
const unb64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
export const sha=async(data:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(data)))).map(b=>b.toString(16).padStart(2,'0')).join('');
// Every Web key is purpose-separated from the existing OAuth master secret.
// Users log in with the existing MCP_AUTH_SECRET directly. HMAC-derived keys are
// used only server-side for Cap.js, proof signing, sessions and replay protection.
// Rotating MCP_AUTH_SECRET invalidates signed proofs and all Web sessions.
// Do not impose a new length gate on an already-configured OAuth secret.
// HMAC works with any nonempty key; operators should still use a high-entropy master.
const secretOk=(env:Env)=>typeof env.MCP_AUTH_SECRET==='string' && env.MCP_AUTH_SECRET.length>0 && env.MCP_AUTH_SECRET!=='replace-with-a-random-secret';
const sessionHash=(env:Env,token:string)=>webHmacHex(env.MCP_AUTH_SECRET,'session',token);
async function key(env:Env){return webCryptoKey(env.MCP_AUTH_SECRET,'proof');}
async function capSecret(env:Env){return bytesToHex(await deriveWebKey(env.MCP_AUTH_SECRET,'cap'));}
const error=(code:string,status=400)=>Response.json({code},{status,headers:{'cache-control':'no-store'}});
type Proof={v:1;id:string;expires:number;purpose:'web-login'};
async function signProof(env:Env,expires:number){
  const data:Proof={v:1,id:crypto.randomUUID(),expires,purpose:'web-login'};
  const payload=b64(utf8.encode(JSON.stringify(data)));
  const sig=await crypto.subtle.sign('HMAC',await key(env),utf8.encode(payload));
  return payload+'.'+b64(new Uint8Array(sig));
}
async function parseProof(env:Env,token:unknown):Promise<Proof|null>{
  if(typeof token!=='string'||token.length>1024||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return null;
  try{
    const [payload,signature]=token.split('.') as [string,string];
    const valid=await crypto.subtle.verify('HMAC',await key(env),unb64(signature),utf8.encode(payload));
    if(!valid)return null;
    const proof=JSON.parse(new TextDecoder().decode(unb64(payload))) as Proof;
    if(proof.v!==1||proof.purpose!=='web-login'||!Number.isSafeInteger(proof.expires)||
      proof.expires<=Date.now()||proof.expires>Date.now()+CAP_TTL+10000||
      !/^[a-f0-9-]{36}$/.test(proof.id))return null;
    return proof;
  }catch{return null;}
}
async function consume(env:Env,raw:string,expires:number){
  if(expires<=Date.now())return false;
  const hash=await webHmacHex(env.MCP_AUTH_SECRET,'nonce',raw);
  const result=await env.DB.prepare('INSERT OR IGNORE INTO web_nonces(id_hash,expires_at) VALUES(?,?)').bind(hash,expires).run();
  return result.meta.changes===1;
}
async function rateLimit(request:Request,env:Env,scope:string,max:number,windowMs:number){
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  const bucket=await webHmacHex(env.MCP_AUTH_SECRET,'rate',scope+':'+ip+':'+Math.floor(Date.now()/windowMs));
  const res=await env.DB.prepare('INSERT INTO web_rate_limits(bucket_hash,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET attempts=attempts+1 RETURNING attempts')
    .bind(bucket,Math.floor(Date.now()/windowMs+1)*windowMs).first<{attempts:number}>();
  return (res?.attempts??max+1)<=max;
}
export function checkOrigin(request:Request){
  const origin=request.headers.get('origin');
  const site=request.headers.get('sec-fetch-site');
  return origin===new URL(request.url).origin && (!site||site==='same-origin'||site==='none');
}
export function cookie(token:string,expires?:number){
  const extra=expires===undefined?'Max-Age=0':'Max-Age='+Math.max(0,Math.floor((expires-Date.now())/1000));
  return WEB_COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; '+extra;
}
export function tokenFromRequest(req:Request){
  const match=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(WEB_COOKIE+'='));
  return match?.slice(WEB_COOKIE.length+1)??null;
}
export type WebSession={id:string;createdAt:number;expiresAt:number;lastSeenAt:number;userAgent:string};
export async function session(req:Request,env:Env):Promise<WebSession|null>{
  if(!secretOk(env))return null;
  const token=tokenFromRequest(req);
  if(!token||!(/^[A-Za-z0-9_-]{40,60}$/).test(token))return null;
  const hash=await sessionHash(env,token);
  const row=await env.DB.prepare('SELECT id,created_at,last_seen_at,expires_at,user_agent_hint FROM web_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?')
    .bind(hash,Date.now()).first<{id:string;created_at:number;last_seen_at:number;expires_at:number;user_agent_hint:string}>();
  if(!row||Date.now()-row.last_seen_at>=SESSION_IDLE)return null;
  if(Date.now()-row.last_seen_at>5*60_000)
    await env.DB.prepare('UPDATE web_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),row.id).run();
  return {id:row.id,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at,userAgent:row.user_agent_hint};
}
export async function capChallenge(req:Request,env:Env){
  if(!secretOk(env))return error('web_auth_not_configured',503);
  if(!checkOrigin(req))return error('invalid_origin',403);
  if(!await rateLimit(req,env,'challenge',30,60_000))return error('rate_limited',429);
  const challenge=await generateChallenge(await capSecret(env),{
    scope:'recalloom:web-login',challengeCount:12,challengeDifficulty:4,expiresMs:5*60_000
  });
  return Response.json(challenge,{headers:{'cache-control':'no-store'}});
}
export async function capRedeem(req:Request,env:Env,payload:unknown){
  if(!secretOk(env))return error('web_auth_not_configured',503);
  if(!checkOrigin(req))return error('invalid_origin',403);
  if(!await rateLimit(req,env,'redeem',60,60_000))return error('rate_limited',429);
  const result=await validateChallenge(await capSecret(env),payload as Parameters<typeof validateChallenge>[1],{
    scope:'recalloom:web-login',
    tokenTtlMs:CAP_TTL,
    consumeNonce:async(signature,ttlMs)=>consume(env,'cap:'+signature,Date.now()+ttlMs),
    signToken:async({expires})=>signProof(env,Math.min(expires,Date.now()+CAP_TTL))
  });
  return Response.json(result,{status:result.success?200:403,headers:{'cache-control':'no-store'}});
}
async function equal(a:string,b:string){
  const x=utf8.encode(a),y=utf8.encode(b);
  let mismatch=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)mismatch|=(x[i]??0)^(y[i]??0);
  return mismatch===0;
}
export async function webLogin(req:Request,env:Env,body:{secret:string;capToken:string}){
  if(!secretOk(env))return error('web_auth_not_configured',503);
  if(!checkOrigin(req))return error('invalid_origin',403);
  if(!await rateLimit(req,env,'login',15,15*60_000))return error('rate_limited',429);
  const proof=await parseProof(env,body.capToken);
  if(!proof||!await consume(env,'proof:'+proof.id,proof.expires))return error('invalid_proof',403);
  if(!await equal(body.secret,env.MCP_AUTH_SECRET))return error('invalid_credentials',401);
  const token=b64(crypto.getRandomValues(new Uint8Array(32)));
  const id=crypto.randomUUID(),now=Date.now(),expiresAt=now+SESSION_ABSOLUTE;
  await env.DB.prepare('INSERT INTO web_sessions(id,token_hash,created_at,last_seen_at,expires_at,user_agent_hint) VALUES(?,?,?,?,?,?)')
    .bind(id,await sessionHash(env,token),now,now,expiresAt,(req.headers.get('user-agent')??'').slice(0,200)).run();
  const response=Response.json({authenticated:true,expiresAt},{headers:{'cache-control':'no-store'}});
  response.headers.set('set-cookie',cookie(token,expiresAt));
  return response;
}
export async function logout(env:Env,id:string){
  await env.DB.prepare('UPDATE web_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),id).run();
}
export async function listWebSessions(env:Env){
  const rows=await env.DB.prepare('SELECT id,created_at AS createdAt,last_seen_at AS lastSeenAt,expires_at AS expiresAt,revoked_at AS revokedAt,user_agent_hint AS userAgent FROM web_sessions WHERE revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100').bind(Date.now()).all();
  return {items:rows.results,page:{hasMore:false,nextCursor:null}};
}
export async function revokeWebSession(env:Env,id:string){
  const result=await env.DB.prepare('UPDATE web_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),id).run();
  return {revoked:Boolean(result.meta.changes)};
}
export async function cleanupWebAuth(env:Env){
  const now=Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM web_nonces WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM web_rate_limits WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM web_sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)').bind(now-7*24*3600_000,now-7*24*3600_000)
  ]);
}
