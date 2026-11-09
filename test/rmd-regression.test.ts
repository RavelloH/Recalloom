import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {JSONContent} from '@tiptap/core';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {lexRmd} from '../web/src/rmd-lexer';
import {collectCrossRefs} from '../web/src/cross-reference';
import {collectRmdPreviewRefs} from '../web/src/rmd-cross-reference';
import {extractWikiReferences} from '../src/wiki-syntax';
import {asAstryBadgeVariant} from '../web/src/rmd-badge';

const walk=(node:JSONContent):JSONContent[]=>[node,...(node.content??[]).flatMap(walk)];
const nodes=(doc:JSONContent,type:string)=>walk(doc).filter(x=>x.type===type);
const containers=(doc:JSONContent)=>nodes(doc,'richContainer').map(x=>String(x.attrs?.kind));
const marks=(doc:JSONContent)=>walk(doc).flatMap(x=>x.marks??[]);
const save=(src:string)=>{
 const doc=parseRmdVisual(src),once=serializeRmdVisual(doc);
 const again=serializeRmdVisual(parseRmdVisual(once));
 assert.equal(again,once,'the second save must not alter the canonical source: '+once);
 return {doc,once};
};
const uuid='550e8400-e29b-41d4-a716-446655440000';

describe('Only RMD 1.0 is the authoritative Markdown component pipeline',()=>{
 it('recognizes eight distinct Callout meanings and icon categories',()=>{
  for(const kind of ['note','info','tip','success','warning','danger','example','question']){
   const src='::: '+kind+' 标题\n\n正文 **重要**。\n\n:::';
   const {doc,once}=save(src);
   assert.deepEqual(containers(doc),[kind],JSON.stringify(doc));
   assert.ok(nodes(doc,'text').some(x=>x.text==='重要'&&x.marks?.some(m=>m.type==='bold')),once);
  }
 });
 it('requires a longer outer fence for nested details and keeps every paragraph',()=>{
  const src=':::: details 父标题 [v2]\n\n普通内容。\n\n::: warning 子标题\n\n**嵌套警告**。\n\n:::\n\n结束内容。\n\n::::';
  const {doc,once}=save(src);
  assert.deepEqual(containers(doc),['details','warning'],JSON.stringify(doc));
  assert.ok(once.includes('父标题 [v2]'));
  assert.equal(nodes(doc,'paragraph').length,3,JSON.stringify(doc));
 });
 it('keeps conflicting equal-width nested fences as visible plaintext',()=>{
  const src='::: details 外层\n\n::: warning 同样宽度\n\n危险正文。\n\n:::\n\n:::';
  const doc=parseRmdVisual(src);
  assert.ok(!containers(doc).includes('warning'),'must not silently create an empty warning');
  assert.ok(serializeRmdVisual(doc).includes('危险正文。'));
 });
 it('only accepts tabs inside tabs parent and keeps three child bodies',()=>{
  const src=[':::: tabs','',
   '::: tab 概览','','A 说明。','',':::','',
   '::: tab 代码','','~~~ts','const x=1;','~~~','',':::','',
   '::: tab 公式','','$x^2$','',':::','','::::'].join('\n');
  const {doc}=save(src);
  assert.deepEqual(containers(doc),['tabs','tab','tab','tab'],JSON.stringify(doc));
  assert.equal(nodes(doc,'codeBlock').length,1);
  assert.equal(nodes(doc,'inlineMath').length,1);
 });
 it('safely rejects a child tab with no tabs parent',()=>{
  const src='::: tab 孤立选项\n\n正文。\n\n:::';
  const doc=parseRmdVisual(src);
  assert.equal(containers(doc).length,0,JSON.stringify(doc));
  assert.ok(serializeRmdVisual(doc).includes('::: tab'));
 });
 it('keeps flashcard front/back and rejects orphan front',()=>{
  const src=':::: flashcard\n\n::: front\n\n为什么？\n\n:::\n\n::: back\n\n$U=IR$\n\n:::\n\n::::';
  const {doc}=save(src);
  assert.deepEqual(containers(doc),['flashcard','front','back']);
  assert.equal(nodes(doc,'inlineMath').length,1);
  assert.equal(containers(parseRmdVisual('::: front\n\n错误\n\n:::')).length,0);
 });
 it('keeps chat sender attrs and glossary definitions structured',()=>{
  const src=':::: chat\n\n::: message Agent | sender=assistant\n\n你好。\n\n:::\n\n::: message 用户 | sender=user\n\n反馈。\n\n:::\n\n::::\n\n:::: glossary\n\n::: definition 电压\n\n$U=IR$。\n\n:::\n\n::::';
  const {doc}=save(src);
  assert.deepEqual(containers(doc),['chat','message','message','glossary','definition']);
  const messages=nodes(doc,'richContainer').filter(n=>n.attrs?.kind==='message');
  assert.deepEqual(messages.map(n=>n.attrs?.sender),['assistant','user']);
 });
 it('makes badge, tooltip, abbr, kbd and cloze individual editable nodes',()=>{
  const src=':: badge 完成 | success :: / :: tooltip DO | description="Durable Objects" :: / :: abbr CPU | description="Central Processing Unit" :: / :: kbd Ctrl :: + :: kbd S :: / :: cloze U=IR | hint=欧姆定律 ::';
  const {doc,once}=save(src);
  assert.equal(nodes(doc,'richBadge').length,1,once);
  assert.equal(nodes(doc,'richTooltip').length,1,once);
  assert.equal(nodes(doc,'richAbbr').length,1,once);
  assert.equal(nodes(doc,'richKbd').length,2,once);
  assert.equal(nodes(doc,'richCloze').length,1,once);
  assert.equal(nodes(doc,'richBadge')[0]?.attrs?.variant,'success');
 });
 it('maps RMD danger semantic variant to actual Astryx error color in both renderers',()=>{
  for(const [value,expected] of [['neutral','neutral'],['info','info'],
   ['success','success'],['warning','warning'],['danger','error'],
   ['unknown','neutral']] as const)
   assert.equal(asAstryBadgeVariant(value),expected);
 });
 it('refuses unsupported badge color/icon and tooltip placement instead of partial promotion',()=>{
  const src=':: badge 工作中 | color=green ::\n\n:: tooltip 文档 | description=内容 | placement=top ::';
  const doc=parseRmdVisual(src);
  assert.equal(nodes(doc,'richBadge').length,0,JSON.stringify(doc));
  assert.equal(nodes(doc,'richTooltip').length,0,JSON.stringify(doc));
  const saved=serializeRmdVisual(doc);
  assert.ok(saved.includes('color=green'));
  assert.ok(saved.includes('placement=top'));
 });
 it('does not turn == equality or obsolete extension brackets into a new component',()=>{
  const src='a == b 且 c == d；:badge[旧值]{variant=success}。';
  const doc=parseRmdVisual(src);
  assert.equal(nodes(doc,'richBadge').length,0);
  assert.equal(marks(doc).filter(m=>m.type==='rmdMark'||m.type==='highlight').length,0);
  assert.ok(serializeRmdVisual(doc).includes('=='));
 });
 it('keeps Mark and nine explicit Highlight colors separate, including inline math',()=>{
  const colors=['red','orange','yellow','green','blue','purple','pink','cyan','teal'];
  const src=[':: mark $E=mc^2$ ::',...colors.map(c=>':: highlight '+c+' | '+c+' ::')].join('\n\n');
  const {doc}=save(src);
  assert.equal(marks(doc).filter(m=>m.type==='rmdMark').length,1);
  assert.equal(marks(doc).filter(m=>m.type==='rmdSketch'&&m.attrs?.kind==='highlight').length,9);
  assert.equal(nodes(doc,'inlineMath')[0]?.marks?.[0]?.type,'rmdMark');
 });
 it('keeps block Mark and colored Highlight around a whole KaTeX block',()=>{
  const src='::: mark\n\n$$\nE=mc^2\n$$\n\n:::\n\n::: highlight | color=green\n\n$$\nP=UI\n$$\n\n:::';
  const {doc}=save(src);
  assert.deepEqual(containers(doc),['mark','highlight']);
  assert.equal(nodes(doc,'blockMath').length,2);
 });
 it('preserves both inline and multiline %% comments without treating them as authorization',()=>{
  const src='正文 %%内部备注%% 结束。\n\n%%\n第一行。\n第二行。\n%%';
  const {doc,once}=save(src);
  assert.equal(marks(doc).filter(m=>m.type==='visibleComment').length,1,once);
  assert.ok(containers(doc).includes('comment'));
  assert.ok(once.includes('%%\n第一行。\n第二行。\n%%'));
 });
 it('keeps all five CriticMarkup types including nested JSON braces in a suggestion',()=>{
  const src='新增 {++{"value":{"ok":true}}++}；删除 {--原句--}；修改 {~~旧~>新~~}；重点 {==词==}；批注 {>>人工确认<<}。';
  const {doc,once}=save(src);
  assert.deepEqual(nodes(doc,'richCritic').map(n=>n.attrs?.kind),
   ['addition','deletion','substitution','highlight','comment'],once);
 });
 it('never promotes RMD tokens within code fences or inline code',()=>{
  const tick=String.fromCharCode(96);
  const src='~~~md\n::: warning 标题\n\n正文\n\n:::\n:: badge x | success ::\n~~~\n\n'+tick+':: badge x | success ::'+tick;
  const doc=parseRmdVisual(src);
  assert.equal(containers(doc).length,0);
  assert.equal(nodes(doc,'richBadge').length,0);
  assert.equal(nodes(doc,'codeBlock').length,1);
 });
 it('preserves escaped and malformed extension text when neighboring strong text is edited',()=>{
  const src='**前半段** <unknown-chip data-value="a"/> 和 **后半段**，以及 :: badge 坏 | unknown ::。';
  const {doc,once}=save(src);
  assert.ok(nodes(doc,'text').filter(n=>n.marks?.some(m=>m.type==='bold')).length>=2,once);
  assert.ok(once.includes('<unknown-chip'));
  assert.ok(once.includes(':: badge 坏 | unknown ::'));
 });
 it('does not parse YAML-looking text as record metadata or run unsafe HTML',()=>{
  const src='---\ntitle: "不是记录标题"\nstatus: active\n---\n\n**正文** <script>alert(1)</script>';
  const doc=parseRmdVisual(src);
  assert.equal(nodes(doc,'richFrontMatter').length,0);
  assert.ok(serializeRmdVisual(doc).includes('title: "不是记录标题"'));
  assert.ok(serializeRmdVisual(doc).includes('script'));
 });
 it('retains hundreds of independent code modifiers without stealing adjacent blocks',()=>{
  const src=Array.from({length:240},(_,i)=>[
   '~~~ts','const v'+i+' = '+i+';','~~~',
   '@ attrs code-'+i+' | file=source'+i+'.ts @'
  ].join('\n')).join('\n\n');
  const {doc,once}=save(src);
  const code=nodes(doc,'codeBlock');
  assert.equal(code.length,240);
  assert.equal(code[0]?.attrs?.id,'code-0');
  assert.equal(code[239]?.attrs?.id,'code-239');
  assert.equal(code[239]?.attrs?.filename,'source239.ts');
  assert.equal(collectCrossRefs(doc).get('code-239')?.label,'代码：source239.ts');
  assert.ok(once.includes('@ attrs code-239 | file=source239.ts @'),once.slice(-1000));
 });
 it('links heading, paragraph and code IDs without treating them as numbered figure references',()=>{
  const src=[
   '## 电力系统分析 @ attrs chapter-power @','',
   '这段需要引用。 @ attrs result-note @','',
   '~~~ts','const value=1;','~~~','@ attrs code-example | file=example.ts @','',
   '引用 [[#chapter-power]]、[[#result-note]]、[[#code-example]]。'
  ].join('\n');
  const {doc,once}=save(src);
  const index=collectCrossRefs(doc);
  const preview=collectRmdPreviewRefs(src);
  for(const id of ['chapter-power','result-note','code-example']){
   assert.ok(index.get(id)?.label,'visual missing local ref '+id+' '+once);
   assert.ok(preview.get(id)?.label,'preview missing local ref '+id);
  }
  assert.equal(nodes(doc,'codeBlock')[0]?.attrs?.id,'code-example',once);
  assert.ok(once.includes('@ attrs code-example | file=example.ts @'),once);
 });
 it('uses the same 80-character ID boundary for syntax, typed references and table identity',()=>{
  const id='fig-'+'x'.repeat(76);
  const src='![图](device.png) @ attrs '+id+' @\n\n参见 [[#'+id+']]。';
  const {doc,once}=save(src);
  assert.equal(nodes(doc,'image')[0]?.attrs?.figureId,id,once);
  assert.equal(collectCrossRefs(doc).get(id)?.label,'图 1',once);
  const bad='fig-'+'x'.repeat(77);
  const invalid=parseRmdVisual('![图](device.png) @ attrs '+bad+' @');
  assert.equal(nodes(invalid,'image')[0]?.attrs?.figureId??null,null);
 });
 it('rejects unrenderable image dimensions instead of silently accepting them',()=>{
  for(const width of [1,39,1801,999999]){
   const src='![图](device.png) @ attrs | width='+width+' @';
   const doc=parseRmdVisual(src);
   assert.equal(nodes(doc,'image')[0]?.attrs?.width??null,null,src);
   assert.ok(serializeRmdVisual(doc).includes('width='+width),src);
  }
  for(const width of [40,480,1800]){
   const doc=parseRmdVisual('![图](device.png) @ attrs | width='+width+' @');
   assert.equal(nodes(doc,'image')[0]?.attrs?.width,width);
  }
 });
 it('assigns title/paragraph IDs, figure attrs, table attrs and display math only from @ attrs',()=>{
  const src=['## 结果 @ attrs result-section @','',
   '这一段有 ID。 @ attrs result-paragraph @','',
   '![实验](device.png) @ attrs fig-device | width=480 | caption=实验装置 @','',
   '$$','P=UI','$$','@ attrs eq-power @','',
   '| A | B |','| --- | --- |','| 1 | 2 |','@ attrs tbl-data | caption=数据 @'].join('\n');
  const {doc}=save(src);
  assert.equal(nodes(doc,'heading')[0]?.attrs?.id,'result-section');
  assert.equal(nodes(doc,'paragraph').find(n=>n.attrs?.blockId)?.attrs?.blockId,'result-paragraph');
  assert.equal(nodes(doc,'image')[0]?.attrs?.figureId,'fig-device');
  assert.equal(nodes(doc,'image')[0]?.attrs?.width,480);
  assert.equal(nodes(doc,'blockMath')[0]?.attrs?.equationId,'eq-power');
  assert.equal(nodes(doc,'table')[0]?.attrs?.tableId,'tbl-data');
 });
 it('does not attach an invalid image width or unknown table/code attributes',()=>{
  const src='![实验](device.png) @ attrs fig-x | width=abc @\n\n~~~ts\nconst n=1;\n~~~\n@ attrs code-one | line-numbers=true @';
  const doc=parseRmdVisual(src);
  assert.ok(serializeRmdVisual(doc).includes('width=abc'));
  assert.ok(serializeRmdVisual(doc).includes('line-numbers=true'));
  assert.equal(nodes(doc,'image')[0]?.attrs?.width??null,null);
 });
 it('supports code fence attrs file/wrap/expand without requiring old [filename] syntax',()=>{
  const src='~~~ts\nconst cfg = { enabled: true };\n~~~\n@ attrs code-example | file=demo.ts | wrap=true | expand=true @';
  const {doc}=save(src);
  const code=nodes(doc,'codeBlock')[0];
  assert.equal(code?.attrs?.filename,'demo.ts');
  assert.equal(code?.attrs?.wrap,true);
  assert.equal(code?.attrs?.expand,true);
 });
 it('indexes only real, validated Wiki references and canonical standalone embeds',()=>{
  const src='[[id:'+uuid+'|别名]]\n\n::: embed id:'+uuid+'#章节 :::\n\n{{embed:id:'+uuid+'}}';
  const {doc}=save(src);
  assert.equal(nodes(doc,'wikiLink').length,1);
  assert.equal(nodes(doc,'wikiEmbed').length,1);
  assert.equal(extractWikiReferences(src).filter(x=>x.kind==='embed').length,1);
 });
 it('allows Wiki aliases inside GFM table cells without extra columns',()=>{
  const src='| 名称 | 链接 |\n| --- | --- |\n| 文档 | [[id:'+uuid+'|别名]] |';
  const {doc,once}=save(src);
  const table=nodes(doc,'table')[0];
  assert.equal(table?.content?.[1]?.content?.length,2,once);
  assert.equal(nodes(doc,'wikiLink').length,1);
  assert.equal(extractWikiReferences(src).length,1);
 });
 it('preserves complex footnote content and nested list',()=>{
  const src='参阅[^note]。\n\n[^note]: 第一段 **重要**。\n\n    - 列表一\n    - 列表二';
  const {doc}=save(src);
  assert.equal(nodes(doc,'richFootnoteRef').length,1);
  assert.equal(nodes(doc,'richFootnoteDefinition').length,1);
  assert.ok(nodes(doc,'bulletList').length>0);
 });
 it('derives local figure/equation/table numbers from current document rather than saved labels',()=>{
  const src=['![装置](device.png) @ attrs fig-device @','','$$','P=UI','$$','@ attrs eq-power @','',
   '| 参数 | 值 |','| --- | --- |','| U | 220 |','@ attrs tbl-data | caption=数据 @'].join('\n');
  const {doc,once}=save(src);
  const refs=collectCrossRefs(doc);
  assert.equal(refs.get('fig-device')?.label,'图 1',once);
  assert.equal(refs.get('eq-power')?.label,'公式 1',once);
  assert.equal(refs.get('tbl-data')?.label,'表 1',once);
  assert.ok(!once.includes('图 1')&&!once.includes('公式 1'),'numbers must be ephemeral');
 });
 it('preserves GFM left/right/center table alignment on canonical save',()=>{
  const src='| 左列 | 右列 | 中列 |\n| :--- | ---: | :---: |\n| A | 42 | 正常 |';
  const {doc,once}=save(src);
  const rows=nodes(doc,'table')[0]?.content??[];
  assert.deepEqual(rows[0]?.content?.map(n=>n.attrs?.textAlign),['left','right','center'],once);
  assert.ok(once.includes('| :--- | ---: | :---: |'),once);
 });
 it('preserves unclosed <mark> as source text rather than a partial highlight node',()=>{
  const src='React <mark> 未闭合，但后续 **加粗** 不应丢失。';
  const {doc,once}=save(src);
  assert.ok(once.includes('<mark>'),once);
  assert.equal(marks(doc).filter(m=>m.type==='rmdMark').length,0);
  assert.equal(nodes(doc,'text').filter(n=>n.marks?.some(m=>m.type==='bold')).length,1);
 });
 it('does not turn package versions into accidental mailto links',()=>{
  const src='Install agent-desktop@1.0.2 now; contact admin@example.com.';
  const {doc,once}=save(src);
  assert.ok(once.includes('agent-desktop@1.0.2'),once);
  const links=marks(doc).filter(m=>m.type==='link');
  assert.ok(!links.some(m=>String(m.attrs?.href??'').includes('agent-desktop')),'package version is not an email');
  assert.ok(links.some(m=>String(m.attrs?.href??'').includes('admin@example.com')),'real email remains a link');
 });
 it('recognizes GitHub alert and HTML kbd/details only through safe import mapping',()=>{
  const src=['> [!IMPORTANT]','> 请检查参数。','','<details>','<summary>内容 [v2]</summary>','','**检查**','','</details>','','按下 <kbd>Ctrl</kbd>。'].join('\n');
  const doc=parseRmdVisual(src);
  assert.ok(containers(doc).includes('info'),JSON.stringify(doc));
  assert.ok(containers(doc).includes('details'),JSON.stringify(doc));
  assert.equal(nodes(doc,'richKbd').length,1,JSON.stringify(doc));
 });
});
