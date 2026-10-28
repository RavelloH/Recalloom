/** Purpose-separated server-side HMAC keys rooted in the existing OAuth secret.
 * Users enter MCP_AUTH_SECRET directly for Web login; only signing, nonce,
 * rate-limit and session keys are derived. No extra password or secret exists.
 */
const encoder=new TextEncoder();
export type WebKeyPurpose='cap'|'proof'|'session'|'rate'|'nonce';
const context=(purpose:WebKeyPurpose)=>'recalloom:web:v1:'+purpose;
export const bytesToHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hmacKey(raw:Uint8Array){
  const owned=new Uint8Array(raw.length);
  owned.set(raw);
  return crypto.subtle.importKey('raw',owned.buffer,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function deriveWebKey(masterSecret:string,purpose:WebKeyPurpose):Promise<Uint8Array>{
  const master=await hmacKey(encoder.encode(masterSecret));
  return new Uint8Array(await crypto.subtle.sign('HMAC',master,encoder.encode(context(purpose))));
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
