import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';

const dist='dist/web';
assert.ok(existsSync(join(dist,'index.html')),'Build first: pnpm build:web');
const html=readFileSync(join(dist,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']\/?(assets\/[^"']+\.js)["']/g)].map(match=>match[1]);
assert.equal(scripts.length,1,'Unexpected entry script count; update bundle audit');
const entry=join(dist,scripts[0]);
const content=readFileSync(entry);
const rawBytes=content.length,gzipBytes=gzipSync(content,{level:9}).length;
const maxEntryGzip=275*1024;
assert.ok(gzipBytes<=maxEntryGzip,
 'Initial JS gzip '+gzipBytes+' exceeds '+maxEntryGzip+' bytes; inspect eager imports before changing the budget');
const assets=readdirSync(join(dist,'assets'));
const deferred=['login','home','library','archive','record','tasks','search','activity','settings','command-palette','motion-primitives','overlayscrollbars','visual-editor'];
for(const name of deferred){
 assert.ok(assets.some(asset=>asset.startsWith(name+'-')&&asset.endsWith('.js')),
  'Expected an independent, on-demand '+name+' chunk');
}
const initialHtmlPreloads=[...html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)/g)].map(m=>m[1]);
assert.ok(!initialHtmlPreloads.some(link=>deferred.some(name=>link.includes('/'+name+'-'))),
 'An on-demand feature has been added back to HTML modulepreload');
const format=bytes=>(bytes/1024).toFixed(1)+' KiB';
console.log('Initial JS budget PASS:',scripts[0],format(rawBytes),'raw,',format(gzipBytes),'gzip; limit',format(maxEntryGzip));
console.log('Deferred chunks verified:',deferred.join(', '),'| HTML modulepreloads:',initialHtmlPreloads.length);
