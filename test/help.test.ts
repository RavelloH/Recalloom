import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type {JSONContent} from '@tiptap/core';
import {HELP_TOPICS,getHelp,listHelpResources} from '../src/help/index.js';
import {extractWikiReferences,parseWikiTarget} from '../src/wiki-syntax.js';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {lexRmd} from '../web/src/rmd-lexer';
const examples=(doc:string)=>[
 ...[...doc.matchAll(/~~~~markdown\n([\s\S]*?)\n~~~~/g)].map(x=>x[1]!),
 ...[...doc.matchAll(/~~~markdown\n([\s\S]*?)\n~~~/g)].map(x=>x[1]!)
];
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const flattened=(root:JSONContent):JSONContent[]=>[root,...(root.content??[]).flatMap(flattened)];

test('help catalog has ten documented topics with stable resource URIs',()=>{
 assert.deepEqual(HELP_TOPICS,['overview','markdown','math','wiki','editing','versions','search','tasks','lifecycle','backup']);
 const resources=listHelpResources();
 assert.equal(resources.length,11);
 assert.equal(resources[0].topic,'index');
 assert.match(resources[0].content,/math.*LaTeX|math.*公式|math.*数学/);
 for(const topic of HELP_TOPICS){
  const page=getHelp(topic);
  assert.equal(page.uri,'recalloom://help/'+topic);
  assert.ok(page.content.startsWith('# '));
  assert.ok(page.content.length>400);
  assert.ok(page.summary.length>5);
  assert.ok(resources.some(r=>r.uri===page.uri&&r.content===page.content));
  assert.ok(parser.parse(page.content).children.length>=2,'invalid document: '+topic);
 }
});
test('published math help uses RMD Mark block and preserves a KaTeX formula',()=>{
 const math=getHelp('math').content;
 const blocks=examples(math);
 assert.ok(blocks.length>=3,'inline, display, and highlighted formula examples expected');
 const marked=blocks.find(x=>x.includes('::: mark\n')&&x.includes('$$'));
 assert.ok(marked,'missing canonical RMD block Mark example');
 const doc=parseRmdVisual(marked!);
 const mark=flattened(doc).find(x=>x.type==='richContainer'&&x.attrs?.kind==='mark');
 assert.ok(mark,JSON.stringify(doc));
 assert.ok(flattened(mark!).some(x=>x.type==='blockMath'),'display formula should remain a rich math node');
 const saved=serializeRmdVisual(doc);
 assert.ok(saved.includes('::: mark'),saved);
 assert.ok(saved.includes('$$'),saved);
 assert.equal(flattened(parseRmdVisual(saved)).filter(x=>x.type==='blockMath').length,1);
 const inline=blocks.find(x=>x.includes(':: mark $'));
 assert.ok(inline);
 const atom=flattened(parseRmdVisual(inline!)).find(x=>x.type==='inlineMath');
 assert.ok(atom?.marks?.some(m=>m.type==='rmdMark'),'inline math must be marked, not recolored');
});
test('Wiki help contains real canonical link and standalone embed syntax',()=>{
 const wiki=getHelp('wiki').content;
 const snippets=examples(wiki);
 assert.ok(snippets.length>=2);
 const all=snippets.flatMap(extractWikiReferences);
 assert.ok(all.filter(x=>x.kind==='link').length>=3,JSON.stringify(all));
 assert.ok(all.filter(x=>x.kind==='embed').length>=3,JSON.stringify(all));
 assert.ok(all.some(x=>x.kind==='embed'&&x.anchor==='总结'),JSON.stringify(all));
 assert.equal(parseWikiTarget('只有名称'),null);
 assert.equal(extractWikiReferences('~~~md\n::: embed id:550e8400-e29b-41d4-a716-446655440000 :::\n~~~').length,0);
});
test('Markdown help documents complete RMD schema and visual constraints',()=>{
 const md=getHelp('markdown').content;
 for(const token of ['CommonMark/GFM','KaTeX',':: mark',':: highlight','::: embed','@ attrs','CriticMarkup','%%',':: badge'])
  assert.ok(md.includes(token),'missing RMD syntax: '+token);
 assert.match(md,/不.*当作.*元数据|不是.*数据库元数据/);
 assert.match(md,/不能.*==|不支持.*==/);
 assert.ok(parser.parse(md).children.some(x=>x.type==='code'),'no fenced examples');
});
test('help metadata exposes deterministic version/hash across tool and resources',()=>{
 const index=getHelp();
 assert.equal(index.schemaVersion,1);
 assert.match(index.helpVersion,/^1\.[a-f0-9]{12}$/);
 assert.match(index.contentHash,/^[a-f0-9]{64}$/);
 assert.ok(index.helpVersion.endsWith(index.contentHash.slice(0,12)));
 assert.ok(index.content.includes(index.contentHash));
 for(const topic of HELP_TOPICS){
  const page=getHelp(topic);
  assert.equal(page.helpVersion,index.helpVersion);
  assert.equal(page.contentHash,index.contentHash);
  assert.equal(page.schemaVersion,index.schemaVersion);
 }
});
test('all published Mark/Highlight examples use one schema and preserve exact semantics',()=>{
 const blocks=examples(getHelp('markdown').content);
 const relevant=blocks.filter(x=>x.includes(':: mark')||x.includes(':: highlight'));
 assert.ok(relevant.length>0);
 for(const source of relevant){
  const lexical=lexRmd(source);
  assert.ok(lexical.some(x=>x.name==='mark'||x.name==='highlight'),'example has no valid mark token: '+source);
  const first=parseRmdVisual(source);
  const saved=serializeRmdVisual(first);
  const second=parseRmdVisual(saved);
  const types=(root:JSONContent)=>flattened(root).filter(x=>x.type==='richContainer')
   .map(x=>[x.attrs?.kind,x.attrs?.color]);
  assert.deepEqual(types(second),types(first),'container semantic drift in '+source);
  const markCount=(root:JSONContent)=>flattened(root).flatMap(x=>(x.marks??[]).map(m=>m.type));
  assert.deepEqual(markCount(second),markCount(first),'inline mark semantic drift in '+source);
 }
});
test('published Wiki document snippets use shared graph and visual RMD semantics',()=>{
 const snippets=examples(getHelp('wiki').content);
 const contents=snippets.filter(x=>x.includes('::: embed'));
 assert.ok(contents.length>=1);
 for(const source of contents){
  const serverEdges=extractWikiReferences(source).filter(x=>x.kind==='embed').length;
  const visual=flattened(parseRmdVisual(source)).filter(x=>x.type==='wikiEmbed').length;
  assert.equal(visual,serverEdges,'preview/editor/server disagree on embed counts');
 }
});
