/** Purpose-separated keys rooted in the existing OAuth administration secret.
 * No Web-specific secret needs to be configured in Cloudflare.
 *
 * Web login credential = HMAC-SHA256(MCP_AUTH_SECRET, "recalloom:web:v1:login")
 * Other Web keys use distinct purpose labels and are never sent to clients.
 */
const encoder=new TextEncoder();
export type WebKeyPurpose='login'|'cap'|'proof'|'session'|'rate'|'nonce';
const context=(purpose:WebKeyPurpose)=>'recalloom:web:v1:'+purpose;
export const bytesToHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const base64url=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
async function hmacKey(raw:Uint8Array){
  const owned=new Uint8Array(raw.length);
  owned.set(raw);
  return crypto.subtle.importKey('raw',owned.buffer,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function deriveWebKey(masterSecret:string,purpose:WebKeyPurpose):Promise<Uint8Array>{
  const master=await hmacKey(encoder.encode(masterSecret));
  return new Uint8Array(await crypto.subtle.sign('HMAC',master,encoder.encode(context(purpose))));
}
export async function webLoginCredential(masterSecret:string):Promise<string>{
  return base64url(await deriveWebKey(masterSecret,'login'));
}
export async function webHmac(masterSecret:string,purpose:WebKeyPurpose,message:string):Promise<Uint8Array>{
  const key=await hmacKey(await deriveWebKey(masterSecret,purpose));
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)));
}
export async function webHmacHex(masterSecret:string,purpose:WebKeyPurpose,message:string):Promise<string>{
  return bytesToHex(await webHmac(masterSecret,purpose,message));
}
export async function webCryptoKey(masterSecret:string,purpose:WebKeyPurpose):Promise<CryptoKey>{
  return hmacKey(await deriveWebKey(masterSecret,purpose));
}
