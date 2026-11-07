/** Full-URL metadata discovery for Rich Markdown, future LinkCard and link preview.
 * Browser talks directly to meta.ravelloh.com with credentials omitted.
 * All image bytes go through the authenticated Recalloom image proxy.
 */
export type LinkPreviewMetadata={
 url:string;finalUrl:string|null;title:string|null;description:string|null;
 siteName:string|null;icon:string|null;image:string|null;
};
type CacheEntry={expire:number;promise:Promise<LinkPreviewMetadata|null>};
const MAX_ENTRIES=128;
const cache=new Map<string,CacheEntry>();
const META_BASE='https://meta.ravelloh.com/';
const META_LIMIT=256*1024;
const MAX_IN_FLIGHT=4;
let active=0;
const queue:(()=>void)[]=[];
async function limited<T>(run:()=>Promise<T>):Promise<T>{
 if(active>=MAX_IN_FLIGHT)await new Promise<void>(resolve=>queue.push(resolve));
 active++;
 try{return await run();}
 finally{active--;queue.shift()?.();}
}
export function normalizedLinkUrl(raw:string):string|null{
 if(raw.length<9||raw.length>2048)return null;
 try{
  const u=new URL(raw);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
  if(u.port&&u.port!=='80'&&u.port!=='443')return null;
  if(!u.hostname.includes('.')||u.hostname.includes('..')||u.hostname.startsWith('.'))return null;
  if(!/^[a-z0-9.-]+$/i.test(u.hostname)||/^[0-9.]+$/.test(u.hostname))return null;
  if(u.hostname==='localhost'||/\.(localhost|local|internal|test|invalid|arpa|lan|home|onion|nip\.io|sslip\.io|xip\.io|lvh\.me|localtest\.me)$/i.test(u.hostname))return null;
  // Preserve the document path, but never expose query parameters or anchors
  // to metadata discovery. The original Markdown href stays unchanged.
  u.search='';
  u.hash='';
  return u.href;
 }catch{return null;}
}
export function normalizedLinkOrigin(raw:string):string|null{
 const url=normalizedLinkUrl(raw);
 if(!url)return null;
 const u=new URL(url);
 return u.origin+'/';
}
export function proxyImageUrl(raw:string|null|undefined,site?:string|null):string|null{
 if(!raw||raw.length>4096)return null;
 try{
  const u=new URL(raw);
  if((u.protocol!=='http:'&&u.protocol!=='https:')||u.username||u.password)return null;
  if(!u.hostname.includes('.')||/^[0-9.]+$/.test(u.hostname)||u.hostname.includes(':'))return null;
  if(u.port&&u.port!=='80'&&u.port!=='443')return null;
  if(u.hostname==='localhost'||/\.(localhost|local|internal|test|invalid|arpa|lan|home|onion|nip\.io|sslip\.io|xip\.io|lvh\.me|localtest\.me)$/i.test(u.hostname))return null;
  u.hash='';
  const query=new URLSearchParams({url:u.href});
  if(site){const origin=normalizedLinkOrigin(site);if(origin)query.set('site',origin);}
  return '/api/link-image?'+query.toString();
 }catch{return null;}
}
function boundedText(response:Response):Promise<string>{
 return (async()=>{
  const length=Number(response.headers.get('content-length')??0);
  if(length>META_LIMIT)throw Error('metadata too large');
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing metadata body');
  let size=0,parts:Uint8Array[]=[];
  try{
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>META_LIMIT)throw Error('metadata too large');
    parts.push(value);
   }
  }finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(size);let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.byteLength;}
  return new TextDecoder().decode(out);
 })();
}
function str(raw:unknown,max:number):string|null{
 return typeof raw==='string'&&raw.trim()?raw.slice(0,max):null;
}
function absoluteAsset(raw:unknown,base:string):string|null{
 if(typeof raw!=='string')return null;
 try{
  const url=new URL(raw,base);
  if(!proxyImageUrl(url.href))return null;
  return url.href;
 }catch{return null;}
}
async function fetchMetadata(url:string):Promise<LinkPreviewMetadata|null>{
 try{
  const endpoint=new URL(META_BASE);
  endpoint.searchParams.set('url',url);
  const response=await fetch(endpoint.href,{method:'GET',mode:'cors',credentials:'omit',
   referrerPolicy:'no-referrer',headers:{accept:'application/json'},
   signal:AbortSignal.timeout(9000)});
  if(!response.ok||!(response.headers.get('content-type')??'').includes('application/json'))return null;
  const raw=JSON.parse(await boundedText(response)) as Record<string,unknown>;
  const finalUrl=normalizedLinkUrl(str(raw.finalUrl,2048)??'')??url;
  return {
   url,finalUrl,title:str(raw.title,500),description:str(raw.description,1800),
   siteName:str(raw.siteName,180),icon:absoluteAsset(raw.icon,finalUrl),
   image:absoluteAsset(raw.image,finalUrl)
  };
 }catch{return null;}
}
export function resolveLinkMetadata(raw:string):Promise<LinkPreviewMetadata|null>{
 const url=normalizedLinkUrl(raw);
 if(!url)return Promise.resolve(null);
 const now=Date.now(),hit=cache.get(url);
 if(hit&&hit.expire>now)return hit.promise;
 if(hit)cache.delete(url);
 const item:CacheEntry={expire:now+5*60*1000,promise:Promise.resolve(null)};
 item.promise=limited(()=>fetchMetadata(url)).then(result=>{
  item.expire=Date.now()+(result?6*60*60*1000:5*60*1000);
  return result;
 });
 if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value!);
 cache.set(url,item);
 return item.promise;
}
export function resolveRemoteIcon(raw:string):Promise<string|null>{
 return resolveLinkMetadata(raw).then(metadata=>{
  const origin=normalizedLinkOrigin(raw);
  const icon=metadata?.icon??(origin?new URL('/favicon.ico',origin).href:null);
  return proxyImageUrl(icon,origin);
 });
}
/** Decorate editor links without mutating ProseMirror-managed nodes.
 *
 * IMPORTANT: Writing inline styles or data-* attributes on editor anchors
 * triggers ProseMirror's DOM observer. On long documents this caused an
 * endless DOM reconciliation loop and unbounded renderer memory growth.
 *
 * Apply URL-specific CSS rules to a stylesheet outside the editor DOM instead.
 * Link metadata is still fetched lazily on viewport intersection. Every
 * generated image URL goes through the existing private Recalloom proxy.
 */
export function decorateEditorLinks(root:HTMLElement):()=>void{
 let alive=true,queued=false;
 const style=document.createElement('style');
 style.setAttribute('data-rk-editor-link-styles','');
 document.head.appendChild(style);
 const sheet=style.sheet;
 const requested=new Set<string>();
 const inserted=new Set<string>();
 const observed=new WeakMap<HTMLAnchorElement,string>();

 const visibility=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   const anchor=entry.target as HTMLAnchorElement;
   visibility.unobserve(anchor);
   const href=anchor.getAttribute('href')??'';
   if(!normalizedLinkUrl(href)||requested.has(href))continue;
   requested.add(href);
   void resolveRemoteIcon(href).then(proxy=>{
    if(!alive||!proxy||!sheet||inserted.has(href))return;
    // CSS.escape handles special characters in full href values; the result
    // is used only in an attribute selector, never interpolated into HTML.
    const selector='.record-main .tiptap a[href="'+CSS.escape(href)+'"]::before';
    const background='url("'+proxy.replace(/\\/g,'%5C').replace(/"/g,'%22')+'")';
    try{
     sheet.insertRule(selector+'{content:"";display:inline-block;width:1em;height:1em;vertical-align:-.16em;margin-right:.24em;background:'+background+' center / contain no-repeat}',sheet.cssRules.length);
     inserted.add(href);
    }catch{
     // An unusual URL must not break editing or trigger a DOM update.
    }
   });
  }
 },{rootMargin:'180px'});

 const scan=()=>{
  queued=false;
  if(!alive)return;
  for(const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))){
   const href=anchor.getAttribute('href')??'';
   if(!normalizedLinkUrl(href)||requested.has(href)||observed.get(anchor)===href)continue;
   visibility.unobserve(anchor);
   observed.set(anchor,href);
   visibility.observe(anchor);
  }
 };

 const mutation=new MutationObserver(records=>{
  // Ignore unrelated DOM churn. The stylesheet is outside ProseMirror, and
  // this observer must never write attributes to editor-owned elements.
  let relevant=false;
  for(const record of records){
   if(record.type==='attributes'&&record.attributeName==='href'){relevant=true;break;}
   if(record.type!=='childList')continue;
   for(const node of Array.from(record.addedNodes)){
    if(node instanceof HTMLAnchorElement||(node instanceof Element&&node.querySelector('a[href]'))){
     relevant=true;break;
    }
   }
   if(relevant)break;
  }
  if(relevant&&!queued){queued=true;queueMicrotask(scan);}
 });
 mutation.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
 scan();
 return()=>{alive=false;mutation.disconnect();visibility.disconnect();style.remove();};
}
