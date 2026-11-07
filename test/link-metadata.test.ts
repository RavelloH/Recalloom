import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {parsePublicImageUrl,proxyRemoteImage,privateImageResponse,sniffSafeImage} from '../src/link-image-proxy';
import {normalizedLinkUrl,proxyImageUrl,resolveLinkMetadata,resolveRemoteIcon} from '../web/src/link-metadata-client';

const PNG=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));

describe('Link metadata direct client and private image proxy',()=>{
 it('keeps full URL and query while filtering private and non-web URLs',()=>{
  assert.equal(normalizedLinkUrl('https://github.com/RavelloH/Recalloom?tab=readme#note'),'https://github.com/RavelloH/Recalloom');
  assert.equal(normalizedLinkUrl('https://127.0.0.1/'),null);
  assert.equal(normalizedLinkUrl('http://localhost:8080/'),null);
  assert.equal(normalizedLinkUrl('javascript:alert(1)'),null);
  assert.equal(normalizedLinkUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizedLinkUrl('http://example.com/hello?a=1#b'),'http://example.com/hello');
 });
 it('fetches metadata directly from Meta API with full URL and omits credentials',async()=>{
  const previous=globalThis.fetch;
  const requests:Array<{url:string;init:RequestInit}>=[];
  globalThis.fetch=(async(raw:RequestInfo|URL,init?:RequestInit)=>{
   requests.push({url:String(raw),init:init??{}});
   return new Response(JSON.stringify({
    title:'A specific article',description:'Description',siteName:'Example',
    finalUrl:'https://content-example.com/posts/42?tag=qa',
    icon:'http://cdn-example.com/favicon.ico',
    image:'https://cdn-example.com/cover.png'
   }),{headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  try{
   const url='https://content-example.com/posts/42?tag=qa#comments';
   const cleanUrl='https://content-example.com/posts/42';
   const [a,b]=await Promise.all([resolveLinkMetadata(url),resolveLinkMetadata(url)]);
   assert.equal(requests.length,1,'same full URL is deduplicated');
   assert.equal(new URL(requests[0]!.url).hostname,'meta.ravelloh.com');
   assert.equal(new URL(requests[0]!.url).searchParams.get('url'),cleanUrl);
   assert.equal(requests[0]!.init.credentials,'omit');
   assert.equal(a?.url,cleanUrl);
   assert.equal(a?.title,'A specific article');
   assert.equal(a?.icon,'http://cdn-example.com/favicon.ico');
   assert.equal(a?.image,'https://cdn-example.com/cover.png');
   assert.deepEqual(a,b);
   const iconPath=await resolveRemoteIcon(url);
   assert.ok(iconPath?.startsWith('/api/link-image?'));
   const parameters=new URL(iconPath!,'https://recalloom.test').searchParams;
   assert.equal(parameters.get('url'),'http://cdn-example.com/favicon.ico');
   assert.equal(parameters.get('site'),'https://content-example.com/');
   assert.equal(requests.length,1);
  }finally{globalThis.fetch=previous;}
 });
 it('formats HTTPS and HTTP asset paths as same-origin authenticated image proxy URLs',()=>{
  assert.equal(proxyImageUrl('http://assets.example.org/favicon.ico'),'/api/link-image?url='+encodeURIComponent('http://assets.example.org/favicon.ico'));
  assert.equal(proxyImageUrl('https://cdn.example.org/cover.png?v=2'),'/api/link-image?url='+encodeURIComponent('https://cdn.example.org/cover.png?v=2'));
  assert.equal(proxyImageUrl('file:///etc/passwd'),null);
 });
 it('blocks local addresses, credentials, ports and SSRF redirect destinations',()=>{
  for(const raw of [
   'http://127.0.0.1/favicon.ico','https://10.2.3.4/a.png','http://[::1]/x',
   'http://localhost/a','https://secret.internal/a','http://metadata.google.internal/x',
   'https://192.168.0.1.nip.io/a.png','https://user:pass@example.com/a.png',
   'http://example.com:8080/a','data:image/png;base64,xxx','file:///etc/passwd'
  ])assert.equal(parsePublicImageUrl(raw),null,raw);
  assert.equal(parsePublicImageUrl('http://public-assets.example.com/favicon.ico')?.protocol,'http:');
  assert.equal(parsePublicImageUrl('https://public-assets.example.com/favicon.ico')?.protocol,'https:');
 });
 it('rejects HTML/SVG payloads even if a server falsely labels them as an image',()=>{
  assert.equal(sniffSafeImage(new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>'))),null);
  assert.equal(sniffSafeImage(new Uint8Array(Buffer.from('<html><script>bad()</script></html>'))),null);
  assert.equal(sniffSafeImage(PNG),'image/png');
 });
 it('retrieves HTTP image bytes with authenticated-route response headers and caches the result',async()=>{
  const original=globalThis.fetch;
  let times=0;
  globalThis.fetch=(async(raw:RequestInfo|URL,opts?:RequestInit)=>{
   times++;
   assert.equal(String(raw),'http://public-icon-test.example.net/icon.png');
   assert.equal(opts?.redirect,'manual');
   return new Response(PNG,{headers:{'content-type':'image/png'}});
  }) as typeof fetch;
  try{
   const [a,b]=await Promise.all([
    proxyRemoteImage('http://public-icon-test.example.net/icon.png'),
    proxyRemoteImage('http://public-icon-test.example.net/icon.png')
   ]);
   assert.equal(times,1);
   assert.equal(a?.contentType,'image/png');
   assert.equal(b?.contentType,'image/png');
   const response=privateImageResponse(a!);
   assert.equal(response.headers.get('cache-control'),'private, no-store');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('content-type'),'image/png');
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(PNG));
  }finally{globalThis.fetch=original;}
 });
 it('does not fetch an internal URL after a redirect',async()=>{
  const original=globalThis.fetch;
  let times=0;
  globalThis.fetch=(async()=>{
   times++;
   return new Response(null,{status:302,headers:{location:'http://127.0.0.1/admin'}});
  }) as typeof fetch;
  try{
   const r=await proxyRemoteImage('https://external-icon-test.example.net/1.png');
   assert.equal(r,null);
   assert.equal(times,1);
  }finally{globalThis.fetch=original;}
 });
 it('rejects disguised SVG and does not cache invalid image bytes',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response('<svg><script>alert(1)</script></svg>',{
   headers:{'content-type':'image/svg+xml'}
  })) as typeof fetch;
  try{assert.equal(await proxyRemoteImage('https://svg-icon-test.example.net/favicon.svg'),null);}
  finally{globalThis.fetch=original;}
 });
});
