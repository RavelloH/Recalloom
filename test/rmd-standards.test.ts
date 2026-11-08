import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {JSONContent} from '@tiptap/core';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {lexRmd} from '../web/src/rmd-lexer';
const walk=(n:JSONContent,t:string):JSONContent[]=>[...(n.type===t?[n]:[]),...(n.content??[]).flatMap(c=>walk(c,t))];
const repeat=(source:string)=>{const a=parseRmdVisual(source);const output=serializeRmdVisual(a);const b=parseRmdVisual(output);return {a,b,output};};
describe('RMD standard Markdown and modifier fidelity',()=>{
 it('preserves multiple paragraphs inside a blockquote',()=>{
  const src=['> 第一段。','>','> 第二段 **强调**。'].join('\n');
  const {b,output}=repeat(src);
  assert.equal(walk(b,'blockquote').length,1,'blockquote must not split\n'+output);
  assert.equal(walk(walk(b,'blockquote')[0]!,'paragraph').length,2,'both paragraphs must stay in quote\n'+output);
  assert.ok(walk(b,'text').some(n=>n.text==='强调'&&n.marks?.some(m=>m.type==='bold')),'strong not lost\n'+output);
 });
 it('preserves nested bullet items and nested ordered list hierarchy',()=>{
  const src=['- 一级 A','  - 二级 A1','  - 二级 A2','- 一级 B','','1. 第一','2. 第二'].join('\n');
  const {a,b,output}=repeat(src);
  assert.equal(walk(a,'bulletList').length,2,JSON.stringify(a));
  assert.equal(walk(b,'bulletList').length,2,'nested list preserved\n'+output);
  assert.equal(walk(b,'orderedList').length,1,'numbering preserved\n'+output);
 });
 it('preserves escaped pipe aliases inside GFM cells and valid RMD inline colored text',()=>{
  const src=['| 说明 | 内容 |','| --- | --- |',
   '| 相关 | [[id:550e8400-e29b-41d4-a716-446655440000\\|文档]] |',
   '| 状态 | :: highlight 正常 | green :: |'].join('\n');
  const {b,output}=repeat(src);
  assert.equal(walk(b,'table').length,1,output);
  assert.equal(walk(walk(b,'table')[0]!,'tableRow')[1]?.content?.length,2,output);
  assert.equal(walk(b,'wikiLink').length,1,output);
  assert.ok(walk(b,'text').some(n=>n.marks?.some(m=>m.type==='highlight'&&m.attrs?.color==='green')),output);
 });
 it('code fence with embedded backticks is never truncated and attrs do not become code',()=>{
  const fence=String.fromCharCode(96).repeat(3);
  const src=[fence+'ts','const inner = "~~~";','const quote = "'+fence+'";',fence,'@ attrs code-api | file="example.ts" | wrap=true @'].join('\n');
  const {b,output}=repeat(src);
  assert.equal(walk(b,'codeBlock').length,1,output);
  assert.equal(walk(b,'codeBlock')[0]?.attrs?.filename,'example.ts',output);
  assert.equal(walk(b,'codeBlock')[0]?.attrs?.wrap,true,output);
  const code=walk(b,'codeBlock')[0]?.content?.map(n=>n.text??'').join('');
  assert.ok(code?.includes('const quote'),JSON.stringify(b));
 });
 it('selects a collision-free fenced code delimiter when code contains both long backtick and tilde runs',()=>{
  const tick=String.fromCharCode(96),triple=tick.repeat(3),quad=tick.repeat(4);
  const src=['~'.repeat(5)+'text','This code contains delimiter-shaped lines.',
   quad,triple,'~~~','~~~~','~'.repeat(5)].join('\n');
  const {b,output}=repeat(src);
  const code=walk(b,'codeBlock');
  assert.equal(code.length,1,output);
  assert.ok((code[0]?.content??[]).some(n=>n.text?.includes(quad)),output);
  assert.ok((code[0]?.content??[]).some(n=>n.text?.includes('~~~~')),output);
 });
 it('standalone safe HTML br remains editable soft line break rather than a raw block',()=>{
  const src='第一行<br/>第二行';
  const {b,output}=repeat(src);
  assert.equal(walk(b,'rawMarkdown').length,0,output);
  assert.equal(walk(b,'hardBreak').length,1,JSON.stringify(b));
 });
 it('normalizes incidental whitespace around <br/> and remains canonical on a second save',()=>{
  const src='第一行。  \n第二行。使用 <br/> 继续输入。';
  const doc=parseRmdVisual(src);
  assert.equal(walk(doc,'hardBreak').length,2,JSON.stringify(doc));
  const first=serializeRmdVisual(doc);
  const second=serializeRmdVisual(parseRmdVisual(first));
  assert.equal(first,second,'a second visual save must not move whitespace across hard breaks');
  assert.ok(first.includes('使用  \n继续输入'),first);
 });
 it('retains standard Markdown link titles and image titles after one visual save',()=>{
  const src='[文档](https://example.com/page "文档标题")\n\n![装置](device.png "实验装置的原图")';
  const {b,output}=repeat(src);
  const text=walk(b,'text').find(n=>n.text==='文档');
  assert.equal(text?.marks?.find(m=>m.type==='link')?.attrs?.title,'文档标题',output);
  assert.equal(walk(b,'image')[0]?.attrs?.title,'实验装置的原图',output);
  const second=serializeRmdVisual(b);
  assert.equal(second,output,'titles must survive canonical save');
 });
 it('does not recognize fake syntax inside a code fence or inline code',()=>{
  const tick=String.fromCharCode(96);
  const src=['~~~md','::: mark','','公式','', ':::','@ attrs invalid @','~~~','',tick+':: mark x ::'+tick].join('\n');
  assert.equal(lexRmd(src).filter(n=>n.type!=='comment').length,0);
 });
});
