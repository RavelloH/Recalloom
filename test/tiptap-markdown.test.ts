import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareVisualMarkdown} from '../web/src/tiptap/visual-input';
import {postProcessTableAlignment} from '../web/src/tiptap/table-alignment';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {TableWithMarkdown} from '../web/src/tiptap/table-with-markdown';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown} from '../web/src/tiptap/markdown-extensions';

test('table alignment is imported without requiring identical Markdown formatting',()=>{
 const source='| Item | Value | Status |\n| :--- | ---: | :---: |\n| A | 42 | Ready |';
 const doc={type:'doc',content:[{type:'table',content:[
  {type:'tableRow',content:[{type:'tableHeader'},{type:'tableHeader'},{type:'tableHeader'}]},
  {type:'tableRow',content:[{type:'tableCell'},{type:'tableCell'},{type:'tableCell'}]}
 ]}]};
 const result=postProcessTableAlignment(doc,source);
 assert.deepEqual(result.content?.[0]?.content?.[0]?.content?.map(x=>x.attrs?.textAlign),['left','right','center']);
 assert.deepEqual(result.content?.[0]?.content?.[1]?.content?.map(x=>x.attrs?.textAlign),['left','right','center']);
});

test('supported formatting keeps Markdown serializers',()=>{
 const render=(ext:any,node:any,children:string)=>{
  const fn=ext.config.renderMarkdown;
  assert.equal(typeof fn,'function');
  return fn(node,{renderChildren:()=>children});
 };
 assert.equal(render(UnderlineWithMarkdown,{},'text'),'<u>text</u>');
 assert.equal(render(HighlightWithMarkdown,{},'text'),'<mark>text</mark>');
 assert.equal(render(SuperscriptWithMarkdown,{},'text'),'<sup>text</sup>');
 assert.equal(render(SubscriptWithMarkdown,{},'text'),'<sub>text</sub>');
 assert.equal(render(CustomHeading,{attrs:{level:3,textAlign:'center'}},'Title'),'<h3 style="text-align: center;">Title</h3>');
 assert.equal(render(CustomHeading,{attrs:{level:2}},'Title'),'## Title');
 assert.equal(render(CustomParagraph,{attrs:{textAlign:'right'}},'Text'),'<p style="text-align: right;">Text</p>');
 const table={content:[{content:[{attrs:{textAlign:'right'},content:[]},{attrs:{textAlign:'center'},content:[]}]},{content:[{content:[]},{content:[]}]}]};
 let i=0;const cols=['H1','H2','A','B'];
 const fn=(TableWithMarkdown as any).config.renderMarkdown;
 const md=fn(table,{renderChildren:()=>cols[i++]});
 assert.match(md,/\| -------: \| :------: \|/);
});

test('unclosed inline mark is only shielded in the temporary visual parser input',()=>{
 const literal='React <mark> 安全渲染';
 assert.equal(prepareVisualMarkdown(literal),'React \\<mark> 安全渲染');
 assert.equal(prepareVisualMarkdown('React <mark>黄色</mark> 安全渲染'),'React <mark>黄色</mark> 安全渲染');
 assert.equal(prepareVisualMarkdown('React \x60<mark>\x60'),'React \x60<mark>\x60');
 assert.equal(prepareVisualMarkdown('React \\<mark> 安全渲染'),'React \\<mark> 安全渲染');
 assert.equal(prepareVisualMarkdown('React <mark class="test"> 安全渲染'),'React <mark class="test"> 安全渲染');
 assert.equal(prepareVisualMarkdown('<mark>独立未闭合'),'<mark>独立未闭合');
 assert.equal(prepareVisualMarkdown('React <mark> A\n\nOther </mark> B'),'React <mark> A\n\nOther </mark> B');
 assert.equal(prepareVisualMarkdown('\x60\x60\x60html\n<mark>\n\x60\x60\x60'),'\x60\x60\x60html\n<mark>\n\x60\x60\x60');
});

test('package versions avoid temporary autolinking while code and email are untouched',()=>{
 assert.equal(prepareVisualMarkdown('Install agent-desktop@1.0.2 now'),'Install agent-desktop\\@1.0.2 now');
 assert.equal(prepareVisualMarkdown('Use \x60agent-desktop@1.0.2\x60'),'Use \x60agent-desktop@1.0.2\x60');
 assert.equal(prepareVisualMarkdown('[release](https://example.com/agent-desktop@1.0.2)'),'[release](https://example.com/agent-desktop@1.0.2)');
 assert.equal(prepareVisualMarkdown('Contact admin@example.com'),'Contact admin@example.com');
 assert.equal(prepareVisualMarkdown('\x60\x60\x60shell\nnpm i agent-desktop@1.0.2\n\x60\x60\x60'),'\x60\x60\x60shell\nnpm i agent-desktop@1.0.2\n\x60\x60\x60');
});
