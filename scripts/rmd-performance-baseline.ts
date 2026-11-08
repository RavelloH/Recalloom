import {performance} from 'node:perf_hooks';
import {cpus,freemem,totalmem,platform,release} from 'node:os';
import {mkdirSync,writeFileSync} from 'node:fs';
import {lexRmd} from '../web/src/rmd-lexer';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';

const round=n=>Math.round(n*100)/100;
function stats(values){
 const sorted=[...values].sort((a,b)=>a-b);
 const pick=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]??0;
 return {medianMs:round(pick(.5)),p95Ms:round(pick(.95)),minMs:round(sorted[0]??0),maxMs:round(sorted.at(-1)??0),samples:values.map(round)};
}
const fixtureAttrs=blocks=>Array.from({length:blocks},(_,i)=>
 '~~~ts\nconst v'+i+'='+i+';\n~~~\n@ attrs code-'+i+' | file=example'+i+'.ts @'
).join('\n\n');
const chunk=i=>[
 '## Section '+i+' @ attrs section-'+i+' @','',
 '这是用于测试 RMD 渲染的常规段落，包含 **粗体**、*斜体*、公式 $U=IR$ 和 :: badge 已验证 | success ::。',
 '链接 [Example](https://example.org/'+i+')，行内标记 :: mark Important '+i+' ::。','',
 '::: warning 注意事项','',
 '这里是一段提示容器的内容，包含列表和公式。',
 '- 第一条','- 第二条','',
 ':::','',
 '~~~typescript',
 'const value'+i+' = {power: '+i+', valid: true};',
 'console.log(value'+i+');','~~~',
 '@ attrs code-'+i+' | file=src/example'+i+'.ts @','',
 '| 名称 | 数值 |',
 '| :--- | ---: |',
 '| 参数'+i+' | '+i+' |','',
 '普通结束段落，提供更多 Markdown 文本与引用。'
].join('\n');
const fixtureMixed=target=>{const list=[];let bytes=0,i=0;while(bytes<target){const block=chunk(i++);list.push(block);bytes+=Buffer.byteLength(block,'utf8')+2;}return list.join('\n\n');};
const cases=[
 ...[30,180,480].map(n=>({id:'attrs-'+n,source:fixtureAttrs(n),blocks:n,kind:'attribute-heavy'})),
 ...[10,50,100].map(n=>({id:'mixed-'+n+'kb',source:fixtureMixed(n*1024),kind:'mixed-rmd'}))
];
const rounds=7;
for(let n=0;n<2;n++){const v=parseRmdVisual(fixtureAttrs(8));serializeRmdVisual(v);lexRmd(fixtureAttrs(8));}
const out={createdAt:new Date().toISOString(),baselineType:'node-rmd',commit:process.env.RMD_BASELINE_COMMIT||'',runtime:{node:process.version,platform:platform(),os:release(),cpu:cpus()[0]?.model,logicalCpu:cpus().length,totalMemGiB:round(totalmem()/2**30),freeMemGiBAtStart:round(freemem()/2**30),gcExposed:typeof globalThis.gc==='function'},method:{rounds,warmup:1,stats:'nearest-rank p95, median over 7 runs; GC before each outer round if available; parse includes source conversion, not DOM'},cases:[]};
for(const c of cases){
 const measures={lex:[],parse:[],serialize:[]};
 let doc;let serialized;
 const times={};
 for(let n=0;n<rounds+1;n++){
  globalThis.gc?.();
  let start=performance.now();
  const tokens=lexRmd(c.source);const lexical=performance.now();
  doc=parseRmdVisual(c.source);const parsed=performance.now();
  serialized=serializeRmdVisual(doc);const end=performance.now();
  if(n!==0){measures.lex.push(lexical-start);measures.parse.push(parsed-lexical);measures.serialize.push(end-parsed);}
  if(n===0)times.warmupMs=round(end-start);
 }
 const result={id:c.id,kind:c.kind,bytes:Buffer.byteLength(c.source,'utf8'),characters:c.source.length,blocks:c.blocks??null,tokenCount:lexRmd(c.source).length,serializedBytes:Buffer.byteLength(serialized,'utf8'),lex:stats(measures.lex),parse:stats(measures.parse),serialize:stats(measures.serialize),warmupMs:times.warmupMs};
 out.cases.push(result);
 console.log([result.id,'bytes='+result.bytes,'lex='+result.lex.medianMs+'ms','parse='+result.parse.medianMs+'ms','serialize='+result.serialize.medianMs+'ms'].join(' '));
}
mkdirSync('tmp',{recursive:true});const path='tmp/rmd-performance-baseline-node.json';writeFileSync(path,JSON.stringify(out,null,2)+'\n');console.log('JSON_SAVED='+path);
