import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {HighlightWithMarkdown,UnderlineWithMarkdown} from '../web/src/tiptap/markdown-extensions';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {RawMarkdown} from '../web/src/tiptap/raw-markdown';
import {RichFrontMatter} from '../web/src/tiptap/rich-frontmatter';
import {RichFootnoteRef,RichFootnoteDefinition} from '../web/src/tiptap/rich-footnotes';
import type {JSONContent} from '@tiptap/core';

const manager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false,codeBlock:false}),
 CustomHeading,CustomParagraph,CodeBlock,Markdown,RawMarkdown,RichFrontMatter,RichFootnoteRef,RichFootnoteDefinition,
 HighlightWithMarkdown,UnderlineWithMarkdown,
]});
const walk=(node:JSONContent,fn:(node:JSONContent)=>void)=>{
 fn(node);for(const child of node.content??[])walk(child,fn);
};
describe('visual-first Markdown import',()=>{
 it('renders inline HTML mark as highlight with nested inline code',()=>{
  const source=[
   '# Markdown 高亮与公式格式测试',
   '',
   '- 频率：<mark>50 Hz</mark>。',
   '- 电压：<mark>`1.05 U_N`</mark>。',
   '- 参数：<mark>短路试验参数 `R_T、X_T`</mark>。',
   '- 原始公式：<mark>`R_T = ΔP_s·U_N²/S_N² × 1000` Ω</mark>'
  ].join('\n');
  const doc=buildVisualMarkdown(source,manager);
  let highlights=0,codeWithinHighlight=0;
  walk(doc,node=>{
   if(node.marks?.some(mark=>mark.type==='highlight'))highlights++;
   if(node.marks?.some(mark=>mark.type==='highlight')&&node.marks?.some(mark=>mark.type==='code'))codeWithinHighlight++;
  });
  assert.ok(highlights>=4);
  assert.ok(codeWithinHighlight>=3,'highlight must preserve nested inline code');
  const exported=manager.serialize(doc);
  assert.ok(exported.includes('<mark>50 Hz</mark>'),'supported highlight stays rich after serialization');
  assert.ok(exported.includes('<mark>')&&exported.includes('`1.05 U_N`'));
 });
 it('keeps unknown HTML and incomplete highlights as editable plain text',()=>{
  const source='<div class="note">Unsupported HTML</div>\n\nA detail[^footnote].\n\n[^footnote]: footnote text.\n\n<mark> incomplete.';
  const doc=buildVisualMarkdown(source,manager);
  let contents='',rawBlocks=0;
  walk(doc,node=>{if(node.type==='rawMarkdown')rawBlocks++;if(node.type==='text')contents+=node.text??'';});
  assert.ok(rawBlocks>=2,'unsupported syntax is locally preserved');
  assert.ok(contents.includes('<div class="note">Unsupported HTML</div>'));
  assert.ok(manager.serialize(doc).includes('[^footnote]'),'GFM footnote is now a structured reference');
  assert.ok(manager.serialize(doc).includes('<mark> incomplete.'),'unclosed HTML-like mark must remain in exported Markdown');
 });
 it('displays YAML front matter as a structured editable card while preserving its Markdown',()=>{
  const doc=buildVisualMarkdown('---\ntitle: Note\ncategory: 学习\n---\n\n# Rich Heading\n\nMore **content**.',manager);
  assert.equal(doc.content?.[0]?.type,'richFrontMatter','YAML is a structured editable metadata card');
  assert.equal(doc.content?.[1]?.type,'heading');
  assert.ok(String(doc.content?.[0]?.attrs?.source??'').includes('title: Note'));
  assert.ok(doc.content?.some(node=>node.type==='paragraph'&&node.content?.some(n=>n.marks?.some(m=>m.type==='bold'))));
 });
 it('keeps text editable when the Markdown parser throws',()=>{
  const source='unsupported syntax\n<future-component>alpha</future-component>';
  const doc=buildVisualMarkdown(source,{parse:()=>{throw Error('parser failure')}});
  assert.equal(doc.content?.[0]?.type,'rawMarkdown');
  assert.ok(doc.content?.[0]?.content?.some(n=>n.type==='text'&&n.text?.includes('unsupported syntax')));
 });
 it('serializes unsupported HTML verbatim when a different heading is edited',()=>{
  const input='# Before\n\n<custom-component data-value="1">\nSome **literal** content\n</custom-component>\n\n## After';
  const doc=buildVisualMarkdown(input,manager);
  assert.equal(doc.content?.[1]?.type,'rawMarkdown');
  assert.equal(doc.content?.[1]?.content?.[0]?.text,'<custom-component data-value="1">\nSome **literal** content\n</custom-component>');
  assert.equal(doc.content?.[2]?.type,'heading');
  doc.content![0]!.content=[{type:'text',text:'Edited'}];
  const output=manager.serialize(doc);
  assert.ok(output.includes('<custom-component data-value="1">\nSome **literal** content\n</custom-component>'),output);
  assert.ok(!output.includes('\\<custom-component'),output);
  assert.ok(output.includes('# Edited'),output);
 });
 it('retains YAML front matter after editing ordinary Markdown',()=>{
  const input='---\ntitle: QA\ncategories: [a, b]\n---\n\n# Original';
  const doc=buildVisualMarkdown(input,manager);
  doc.content![1]!.content=[{type:'text',text:'Changed'}];
  const output=manager.serialize(doc);
  assert.ok(output.startsWith('---\ntitle: QA\ncategories: [a, b]\n---'),output);
  assert.ok(output.includes('# Changed'),output);
 });
 it('keeps unsupported inline syntax plain but nearby rich paragraphs rich',()=>{
  const input='## Header\n\nBefore <custom-token name="X"/> after.\n\nThis is **rich**.';
  const doc=buildVisualMarkdown(input,manager);
  assert.equal(doc.content?.[1]?.type,'rawMarkdown');
  assert.equal(doc.content?.[2]?.type,'paragraph');
  assert.ok(doc.content?.[2]?.content?.some(n=>n.marks?.some(m=>m.type==='bold')));
  const output=manager.serialize(doc);
  assert.ok(output.includes('Before <custom-token name="X"/> after.'),output);
 });
});
