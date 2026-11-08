import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {lexRmd} from '../web/src/rmd-lexer';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';

/** Reproducible local RMD modifier scaling probe. No database, network,
 * wall-clock threshold or source files. Use: pnpm exec tsx scripts/rmd-performance.ts
 */
for(const blocks of [30,90,180,300,480]){
 const input=Array.from({length:blocks},(_,i)=>
  '~~~ts\nconst v'+i+'='+i+';\n~~~\n@ attrs code-'+i+' | file=example'+i+'.ts @'
 ).join('\n\n');
 const start=performance.now();
 const attrs=lexRmd(input).filter(token=>token.type==='attrs');
 const lexical=performance.now();
 const first=parseRmdVisual(input);
 const parsed=performance.now();
 const text=serializeRmdVisual(first);
 const serialized=performance.now();
 assert.equal(attrs.length,blocks);
 assert.equal(first.content?.filter(x=>x.type==='codeBlock').length,blocks);
 assert.equal(serializeRmdVisual(parseRmdVisual(text)),text,'canonical save must be stable');
 console.log(JSON.stringify({
  blocks,bytes:input.length,attrs:attrs.length,
  lexicalMs:Math.round(lexical-start),parseMs:Math.round(parsed-lexical),
  serializeMs:Math.round(serialized-parsed)
 }));
}
