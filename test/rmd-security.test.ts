import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {lexRmd,MAX_RMD_CONTAINER_DEPTH,MAX_RMD_FENCE_LENGTH} from '../web/src/rmd-lexer';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {projectRmdPreview} from '../web/src/rmd-preview';
import {extractWikiReferences} from '../src/wiki-syntax';
const walk=(n:any):any[]=>[n,...(n.content??[]).flatMap(walk)];
const deep=(depth:number)=>{
 const open=Array.from({length:depth},(_,i)=>':'.repeat(depth+4-i)+' info Level'+i);
 const close=Array.from({length:depth},(_,i)=>':'.repeat(5+i));
 return [...open,'正文保持完整。',...close].join('\n\n');
};
describe('RMD release security and adversarial input boundaries',()=>{
 it('treats >maximum nested containers as literal text, never recursive semantic nesting',()=>{
  assert.equal(MAX_RMD_CONTAINER_DEPTH,10);
  const source=deep(24);
  assert.equal(lexRmd(source).filter(x=>x.type==='block').length,0);
  const parsed=parseRmdVisual(source);
  assert.equal(walk(parsed).filter(x=>x.type==='richContainer').length,0);
  assert.equal(serializeRmdVisual(parsed),source);
 });
 it('rejects unbounded colon fences as normal text and accepts ordinary nested components',()=>{
  const invalid=':'.repeat(MAX_RMD_FENCE_LENGTH+1)+' note\n\n正文\n\n'+':'.repeat(MAX_RMD_FENCE_LENGTH+1);
  assert.equal(lexRmd(invalid).filter(x=>x.type==='block').length,0);
  const source=':::: details 摘要\n\n::: warning 检查\n\n加粗 **说明**。\n\n:::\n\n::::';
  const parsed=parseRmdVisual(source);
  assert.equal(walk(parsed).filter(x=>x.type==='richContainer').length,2);
  assert.equal(serializeRmdVisual(parseRmdVisual(serializeRmdVisual(parsed))),serializeRmdVisual(parsed));
 });
 it('keeps Unicode/combining characters in a stable canonical Markdown representation',()=>{
  const source=['# 🌍 多语 / 𝑬=𝒎𝒄²','', '汉字 🎉 e\u0301 العربية 日本語 العربية.',
   '', '公式 $E=mc^2$、%%私有注释%%、:: mark **重点** ::','',
   ':: tooltip 温度 | description="热力学 🌡️ x=1 | y=2" ::'].join('\n');
  const once=serializeRmdVisual(parseRmdVisual(source));
  const twice=serializeRmdVisual(parseRmdVisual(once));
  assert.equal(twice,once);
  assert.ok(once.includes('e\u0301'));
  assert.ok(once.includes('العربية'));
  assert.ok(once.includes('🎉'));
 });
 it('never reinterpret raw user HTML as an executable custom RMD directive',()=>{
  const src=['<script>alert(1)</script>','',
   '<img src=x onerror=alert(1)>','',
   '::: link-card javascript:alert(1) :::','',
   '## 非法 @ attrs | width=999999 @'].join('\n');
  const source=serializeRmdVisual(parseRmdVisual(src));
  assert.ok(source.includes('javascript:alert(1)'));
  assert.ok(source.includes('onerror='));
  assert.equal(lexRmd(src).some(x=>x.name==='link-card'),false);
 });
 it('ignores escaped, mathematical, code and URL literal Wiki/critic syntax',()=>{
  const id='550e8400-e29b-41d4-a716-446655440000';
  const src=['代码 \x60[[id:'+id+']]\x60 与普通 [[id:'+id+']]','',
   '$$','\\text{literal {++must-keep++}}','$$','',
   '[外部链接](https://example.com/[[id:'+id+']])'].join('\n');
  assert.equal(extractWikiReferences(src).length,1);
  assert.ok(projectRmdPreview(src).includes('{++must-keep++}'));
 });
 it('preserves LF/CRLF document offsets in the source-derived Wiki index',()=>{
  const id='550e8400-e29b-41d4-a716-446655440000';
  for(const eol of ['\n','\r\n']){
   const source=['# 标题','引用 [[id:'+id+']]。','第二条 [[id:'+id+'|名字]]。'].join(eol);
   const refs=extractWikiReferences(source);
   const a=source.indexOf('[['),b=source.indexOf('[[',a+2);
   assert.deepEqual(refs.map(x=>x.offset),[a,b]);
  }
 });
});
