import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {RichImage} from '../web/src/tiptap/rich-image';
import {RawMarkdown} from '../web/src/tiptap/raw-markdown';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {parseFigureSuffix,serializeFigureSuffix,safeFigureImageSrc} from '../web/src/figure-syntax';
import {remarkFigureAttributes} from '../web/src/remark-figure';

const manager=new MarkdownManager({extensions:[StarterKit,Markdown,RichImage.configure({allowBase64:false}),RawMarkdown]});
describe('safe Markdown figure attributes',()=>{
 it('parses bounded pixel dimensions and a JSON-escaped caption',()=>{
  assert.deepEqual(parseFigureSuffix('{width=480 height=320 caption="部署 \\\"架构\\\""}'),
   {width:480,height:320,caption:'部署 "架构"'});
  assert.equal(serializeFigureSuffix({width:480,height:null,caption:'中文 图注'}),'{width=480 caption="中文 图注"}');
 });
 it('rejects invalid, unknown, duplicate, or risky attributes without partial interpretation',()=>{
  for(const tail of ['{width=999999}','{width=-10}','{width=0}','{width=480 style="color:red"}',
    '{height=300 width=301 width=400}','{caption=<script>}','{width=480\ncaption="abc"}',
    '{caption="unterminated}','{width=40.5}']){
   assert.equal(parseFigureSuffix(tail),null,tail);
  }
  for(const src of ['javascript:alert(1)','data:image/svg+xml,abc','http://127.0.0.1/i.png','//site.com/i.png']){
   // Policy permits only http(s) or relative; localhost needs higher-level
   // network/image-src restrictions, not direct Markdown image proxying.
   if(src==='http://127.0.0.1/i.png')continue;
   assert.equal(safeFigureImageSrc(src),false,src);
  assert.equal(safeFigureImageSrc('assets/diagram.png'),true,'relative local images are valid');
  assert.equal(safeFigureImageSrc('./notes/figure.png'),true);
  assert.equal(safeFigureImageSrc('../images/a.png'),true);
  }
 });
 it('turns standalone image attributes into an editable image node and roundtrips',()=>{
  const source='![架构图](https://example.com/architecture.png){width=480 caption="部署架构"}';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(doc.content?.length,1,JSON.stringify(doc));
  const image=doc.content?.[0]!;
  assert.equal(image.type,'image');
  assert.equal(image.attrs?.src,'https://example.com/architecture.png');
  assert.equal(image.attrs?.width,480);
  assert.equal(image.attrs?.caption,'部署架构');
  assert.equal(manager.serialize(doc),source);
  assert.equal(buildVisualMarkdown(manager.serialize(doc),manager).content?.[0]?.attrs?.caption,'部署架构');
 });
 it('keeps ordinary image Markdown compatible and leaves unknown attrs as literal text',()=>{
  const normal='![Example](https://example.com/image.png "Title")';
  const doc=buildVisualMarkdown(normal,manager);
  assert.equal(doc.content?.[0]?.type,'image',JSON.stringify(doc));
  assert.equal(manager.serialize(doc),normal);
  const unknown='![Example](https://example.com/image.png){style="float:left"}';
  const mixed=buildVisualMarkdown(unknown,manager);
  assert.ok(JSON.stringify(mixed).includes('style='),'unknown attribute must remain visible');
  assert.ok(manager.serialize(mixed).includes('style='));
  const inline=buildVisualMarkdown('说明 ![Icon](https://example.com/i.png){width=480} 内容。',manager);
  assert.ok(JSON.stringify(inline).includes('width=480'),'inline extension should not be silently applied');
 });
 it('isolates figure styling from markdown code and produces safely encoded preview attrs',()=>{
  const tree=unified().use(remarkParse).parse(
   '![架构](https://example.com/a.png){width=420 caption="图注"}\n\n~~~md\n![代码](https://example.com/a.png){width=420}\n~~~');
  const plugin=remarkFigureAttributes();
  plugin(tree);
  assert.equal(tree.children?.[0]?.type,'html');
  const payload=String(tree.children?.[0]?.value??'');
  assert.match(payload,/^<rk-figure data-payload="/);
  assert.ok(!payload.includes('<script'));
  assert.ok(payload.includes(encodeURIComponent('图注')));
  assert.equal(tree.children?.[1]?.type,'code');
 });
});
