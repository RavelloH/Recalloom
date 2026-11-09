import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {remarkRmdSyntax} from '../web/src/rmd-remark';
type Md={type:string;value?:string;name?:string;data?:{hName?:string;hProperties?:Record<string,string>};children?:Md[]};
const parse=(source:string):Md=>{
 const processor=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
 const ast=processor.parse(source) as Md;
 remarkRmdSyntax(source)(ast);
 return ast;
};
const all=(n:Md,type:string):Md[]=>[...(n.data?.hName===type?[n]:[]),...(n.children??[]).flatMap(c=>all(c,type))];
describe('RMD shared MDAST renderer',()=>{
 it('renders Inline Mark and explicit Highlight with distinct data and preserved formula',()=>{
  const doc=parse('这是 :: mark $E=mc^2$ :: 和 :: highlight 重点 | yellow ::。');
  const marks=all(doc,'mark');
  assert.equal(marks.length,1,JSON.stringify(doc));
  assert.equal(all(doc,'rk-sketch').length,1,JSON.stringify(doc));
  assert.equal(marks[0]?.data?.hProperties?.dataRkColor,undefined);
  assert.equal(all(doc,'rk-sketch')[0]?.data?.hProperties?.dataRkSketchColor,'yellow');
  assert.ok(marks[0]?.children?.some(c=>c.type==='inlineMath'),JSON.stringify(doc));
 });
 it('renders badge and tooltip with schema-derived exact properties',()=>{
  const doc=parse('结果 :: badge 已完成 | success ::，说明 :: tooltip DO | description=Durable Objects ::。');
  assert.equal(all(doc,'rk-badge')[0]?.data?.hProperties?.dataVariant,'success',JSON.stringify(doc));
  assert.equal(all(doc,'rk-tooltip')[0]?.data?.hProperties?.dataContent,'Durable Objects',JSON.stringify(doc));
 });
 it('preserves invalid unknown text rather than interpreting nodes',()=>{
  const doc=parse(':: highlight 未提供颜色 :: 和 :: badge a | nonsense ::。');
  assert.equal(all(doc,'mark').length,0);
  assert.equal(all(doc,'rk-sketch').length,1);
  assert.equal(all(doc,'rk-badge').length,0);
  assert.ok(JSON.stringify(doc).includes('未提供颜色'));
 });
 it('creates nested block semantic nodes, retaining normal Markdown and image',()=>{
  const doc=parse([':::: tabs','','::: tab 概览','','这里是 **重点**。','',':::','','::::'].join('\n'));
  assert.equal(all(doc,'rk-callout').length,2,JSON.stringify(doc));
  assert.equal(all(doc,'rk-callout')[0]?.data?.hProperties?.dataKind,'tabs');
  assert.equal(all(doc,'rk-callout')[1]?.data?.hProperties?.dataKind,'tab');
  assert.ok(JSON.stringify(doc).includes('strong'));
 });
 it('keeps block Mark and Highlight distinct for full math blocks',()=>{
  const doc=parse(['::: mark','','$$','E=mc^2','$$','',':::','','::: highlight | yellow','','$$','P=UI','$$','',':::'].join('\n\n').replace(/\n\n\n/g,'\n\n'));
  assert.equal(all(doc,'rk-rmd-block-mark').length,1,JSON.stringify(doc));
  assert.equal(all(doc,'rk-sketch-block').length,1,JSON.stringify(doc));
  assert.equal(all(doc,'rk-rmd-block-mark')[0]?.data?.hProperties?.dataRkColor,undefined);
  assert.equal(all(doc,'rk-sketch-block')[0]?.data?.hProperties?.dataRkSketchColor,'yellow');
  assert.ok(all(doc,'rk-rmd-block-mark')[0]?.children?.some(c=>c.type==='math'));
 });
 it('attaches heading attr and removes its source modifier in projection',()=>{
  const doc=parse('## 电力系统分析 @ attrs power-system @');
  assert.equal(doc.children?.[0]?.data?.hProperties?.id,'power-system',JSON.stringify(doc));
  assert.equal(JSON.stringify(doc).includes('@ attrs'),false);
 });
 it('keeps a code block stable anchor on its preview AST',()=>{
  const src=['~~~ts','const a=1;','~~~','@ attrs code-example | file=example.ts @'].join('\n');
  const doc=parse(src);
  const code=doc.children?.find(n=>n.type==='code');
  assert.equal(code?.data?.hProperties?.id,'code-example',JSON.stringify(doc));
  assert.equal(code?.data?.hProperties?.dataFile,'example.ts');
  assert.ok(!JSON.stringify(code).includes('@ attrs'));
 });
 it('attaches standalone table caption and image attrs without including raw directives in display',()=>{
  const doc=parse(['![实验](experiment.png) @ attrs fig-device | width=480 | caption=实验装置 @','','| 参数 | 数值 |','| --- | --- |','| 电压 | 220 |','@ attrs tbl-parameters | caption=实验参数 @'].join('\n'));
  assert.equal(all(doc,'rk-figure').length,1,JSON.stringify(doc));
  assert.equal(doc.children?.find(c=>c.type==='table')?.data?.hProperties?.dataRmdCaption,'实验参数',JSON.stringify(doc));
 });
});
