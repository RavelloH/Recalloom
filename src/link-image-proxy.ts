/** Authenticated image proxy for remote link metadata.
 * Only public HTTP(S) endpoints on standard ports are accepted. A redirect
 * is followed manually and re-validated at every hop. No cookies, tokens or
 * browser request headers are forwarded to third-party hosts.
 */
export type ProxiedImage={bytes:Uint8Array;contentType:string};
const MAX_IMAGE_BYTES=5*1024*1024;
const MAX_CACHE_BYTES=12*1024*1024;
const MAX_CACHE_ITEMS=64;
const MAX_INFLIGHT=8;
const TTL_MS=30*60*1000;
const REDIRECT_LIMIT=3;
const BLOCKED_SUFFIXES=['.localhost','.local','.localdomain','.internal','.test','.invalid','.arpa','.lan','.home','.onion','.corp','.intranet','.nip.io','.sslip.io','.xip.io','.lvh.me','.localtest.me'];
const cache=new Map<string,{image:ProxiedImage;expires:number}>();
const pending=new Map<string,Promise<ProxiedImage|null>>();
let cacheBytes=0;

export function parsePublicImageUrl(raw:string):URL|null{
 if(raw.length>4096||raw.length<10)return null;
 try{
  const url=new URL(raw);
  if(url.protocol!=='http:'&&url.protocol!=='https:')return null;
  if(url.username||url.password||url.hash)return null;
  if(url.port&&url.port!=='80'&&url.port!=='443')return null;
  const hostname=url.hostname.toLowerCase();
  if(hostname.length>253||!hostname.includes('.')||hostname.startsWith('.')||hostname.endsWith('.')||hostname.includes('..'))return null;
  if(!/^[a-z0-9.-]+$/.test(hostname))return null;
  if(/^[0-9.]+$/.test(hostname)||hostname.includes(':'))return null; // IP literals, including IPv6/URL-normalized hex/octal IPv4
  if(hostname==='localhost'||BLOCKED_SUFFIXES.some(s=>hostname.endsWith(s)))return null;
  // Special-use domains are never valid browser-facing metadata assets.
  if(hostname==='metadata.google.internal'||hostname==='169.254.169.254.nip.io')return null;
  return url;
 }catch{return null;}
}
export function sniffSafeImage(bytes:Uint8Array):string|null{
 if(bytes.length<12)return null;
 const starts=(values:number[])=>values.every((value,i)=>bytes[i]===value);
 if(starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return 'image/png';
 if(starts([0xff,0xd8,0xff]))return 'image/jpeg';
 if(starts([0x47,0x49,0x46,0x38])&&(bytes[4]===0x37||bytes[4]===0x39)&&bytes[5]===0x61)return 'image/gif';
 if(starts([0x52,0x49,0x46,0x46])&&[0x57,0x45,0x42,0x50].every((v,i)=>bytes[8+i]===v))return 'image/webp';
 if(starts([0,0,1,0]))return 'image/x-icon';
 if(starts([0x42,0x4d]))return 'image/bmp';
 const ftyp=String.fromCharCode(...bytes.subarray(4,12));
 if(ftyp.startsWith('ftyp')&&(ftyp.slice(4)==='avif'||ftyp.slice(4)==='avis'))return 'image/avif';
 // Deliberately reject SVG and arbitrary XML/HTML: this endpoint is same-origin.
 return null;
}
async function readImage(response:Response):Promise<ProxiedImage|null>{
 if(!response.ok)return null;
 const headerType=(response.headers.get('content-type')??'').toLowerCase().split(';')[0]?.trim()??'';
 if(headerType==='image/svg+xml'||headerType.startsWith('text/')||headerType==='application/json'||headerType==='application/xml')return null;
 const len=Number(response.headers.get('content-length')??0);
 if(!Number.isFinite(len)||len>MAX_IMAGE_BYTES)return null;
 const reader=response.body?.getReader();
 if(!reader)return null;
 const parts:Uint8Array[]=[];let count=0;
 try{
  while(true){
   const chunk=await reader.read();
   if(chunk.done)break;
   count+=chunk.value.byteLength;
   if(count>MAX_IMAGE_BYTES)return null;
   parts.push(chunk.value);
  }
 }finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(count);
 let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const contentType=sniffSafeImage(bytes);
 return contentType?{bytes,contentType}:null;
}
async function downloadImage(source:URL):Promise<ProxiedImage|null>{
 let current=source;
 for(let i=0;i<=REDIRECT_LIMIT;i++){
  const response=await fetch(current.href,{
   method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),
   headers:{accept:'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,image/*;q=0.8'}
  });
  if(response.status>=300&&response.status<400){
   if(i===REDIRECT_LIMIT)return null;
   const location=response.headers.get('location');
   if(!location)return null;
   const next=parsePublicImageUrl(new URL(location,current).href);
   if(!next)return null;
   current=next;
   continue;
  }
  return readImage(response);
 }
 return null;
}
function cacheImage(key:string,image:ProxiedImage){
 if(image.bytes.byteLength>MAX_CACHE_BYTES/2)return;
 while(cache.size>=MAX_CACHE_ITEMS||cacheBytes+image.bytes.byteLength>MAX_CACHE_BYTES){
  const oldest=cache.keys().next().value as string|undefined;
  if(!oldest)break;
  cacheBytes-=cache.get(oldest)!.image.bytes.byteLength;
  cache.delete(oldest);
 }
 cache.set(key,{image,expires:Date.now()+TTL_MS});
 cacheBytes+=image.bytes.byteLength;
}
export async function proxyRemoteImage(raw:string):Promise<ProxiedImage|null>{
 const url=parsePublicImageUrl(raw);
 if(!url)return null;
 const key=url.href;
 const found=cache.get(key);
 if(found){
  if(found.expires>Date.now())return found.image;
  cacheBytes-=found.image.bytes.byteLength;cache.delete(key);
 }
 const ongoing=pending.get(key);
 if(ongoing)return ongoing;
 if(pending.size>=MAX_INFLIGHT)return null;
 const task=downloadImage(url).then(image=>{
  if(image)cacheImage(key,image);
  return image;
 }).catch(()=>null).finally(()=>pending.delete(key));
 pending.set(key,task);
 return task;
}
export function privateImageResponse(image:ProxiedImage):Response{
 return new Response(image.bytes.slice().buffer,{status:200,headers:{
  'content-type':image.contentType,
  'content-length':String(image.bytes.byteLength),
  'cache-control':'private, no-store',
  'content-security-policy':"default-src 'none'; sandbox",
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'cross-origin-resource-policy':'same-origin',
  'referrer-policy':'no-referrer'
 }});
}
