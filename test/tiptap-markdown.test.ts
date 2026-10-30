import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalMarkdown,markdownRoundTripSafe,prepareVisualMarkdown} from '../web/src/tiptap/fidelity';
import {postProcessTableAlignment} from '../web/src/tiptap/table-alignment';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {TableWithMarkdown} from '../web/src/tiptap/table-with-markdown';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown} from '../web/src/tiptap/markdown-extensions';

test('NeutralPress underline notation and semantic HTML can safely roundtrip',()=>{
 assert.ok(markdownRoundTripSafe('++underlined++','<u>underlined</u>'));
 assert.ok(markdownRoundTripSafe('Text ++a b++ plus','Text <u>a b</u> plus'));
 assert.equal(canonicalMarkdown('Text \x60++literal++\x60'),'Text \x60++literal++\x60');
 assert.equal(canonicalMarkdown('\x60\x60\x60md\n++code++\n\x60\x60\x60'),'\x60\x60\x60md\n++code++\n\x60\x60\x60');
 assert.equal(markdownRoundTripSafe('<div class="callout">KEEP</div>','KEEP'),false);
 assert.equal(markdownRoundTripSafe('---\ntitle: example\n---','# example'),false);
});

test('NeutralPress table alignment normalization preserves all column alignments',()=>{
 const source='| Item | Value | Status |\n| :--- | ---: | :---: |\n| A | 42 | Ready |';
 const output='| Item | Value | Status |\n| -------- | -------: | :------: |\n| A | 42 | Ready |\n\n';
 assert.ok(markdownRoundTripSafe(source,output));
 assert.equal(markdownRoundTripSafe(source,output.replace('-------:','--------')),false);
 const doc={type:'doc',content:[{type:'table',content:[
  {type:'tableRow',content:[{type:'tableHeader'},{type:'tableHeader'},{type:'tableHeader'}]},
  {type:'tableRow',content:[{type:'tableCell'},{type:'tableCell'},{type:'tableCell'}]}
 ]}]};
 const result=postProcessTableAlignment(doc,source);
 assert.deepEqual(result.content?.[0]?.content?.[0]?.content?.map(x=>x.attrs?.textAlign),['left','right','center']);
 assert.deepEqual(result.content?.[0]?.content?.[1]?.content?.map(x=>x.attrs?.textAlign),['left','right','center']);
});

test('Upstream NeutralPress extensions implement Markdown serializers',()=>{
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

test('semantic Markdown admits harmless whitespace and link normalization but rejects information loss',()=>{
 assert.ok(markdownRoundTripSafe('# Heading\n\nPara A.\n\n\nPara B.','# Heading\n\nPara A.\n\nPara B.'));
 assert.ok(markdownRoundTripSafe('Visit <https://example.com>.','Visit [https://example.com](https://example.com).'));
 assert.equal(markdownRoundTripSafe('**important**','important'),false);
 assert.equal(markdownRoundTripSafe('`code`','code'),false);
 assert.equal(markdownRoundTripSafe('\x60\x60\x60ts title=demo.ts\nconst v=1;\n\x60\x60\x60','\x60\x60\x60ts\nconst v=1;\n\x60\x60\x60'),false);
 assert.equal(markdownRoundTripSafe('A reference[^note].\n\n[^note]: Details.','A reference.'),false);
 assert.equal(markdownRoundTripSafe('<div class="alert">Sensitive</div>','Sensitive'),false);
 assert.equal(markdownRoundTripSafe('---\ntitle: Metadata\n---\n\n# Page','---\ntitle: Metadata\n---\n\n# Page'),false);
 assert.equal(markdownRoundTripSafe('+++\ntitle = "Metadata"\n+++\n\n# Page','+++\ntitle = "Metadata"\n+++\n\n# Page'),false);
});

test('literal identifier placeholders are safely escaped without losing their text',()=>{
 assert.ok(markdownRoundTripSafe('Actor web:owner:<sessionId>','Actor web:owner:\\<sessionId\\>'));
 assert.ok(markdownRoundTripSafe('MCP grant:<actorId>','MCP grant:\\<actorId\\>'));
 assert.equal(markdownRoundTripSafe('React <mark> text','React \\<mark\\> text'),true);
 assert.equal(markdownRoundTripSafe('<sessionId>text</sessionId>','\\<sessionId\\>text\\</sessionId\\>'),false);
});

test('literal orphan mark in prose renders as text without blocking visual editing',()=>{
 const literal='React <mark> 安全渲染';
 assert.equal(prepareVisualMarkdown(literal),'React \\<mark> 安全渲染');
 assert.ok(markdownRoundTripSafe(literal,'React \\<mark> 安全渲染'));
 assert.ok(markdownRoundTripSafe(literal,'React &lt;mark&gt; 安全渲染'));
 assert.equal(prepareVisualMarkdown('React <mark>黄色</mark> 安全渲染'),'React <mark>黄色</mark> 安全渲染');
 assert.ok(markdownRoundTripSafe('<mark>黄色</mark>','<mark>黄色</mark>'));
 assert.equal(markdownRoundTripSafe('React <mark>黄色</mark>','React \\<mark\\>黄色\\</mark\\>'),false);
 assert.equal(prepareVisualMarkdown('React `\u003cmark>`'),'React `\u003cmark>`');
 assert.equal(prepareVisualMarkdown('React \\<mark> 安全渲染'),'React \\<mark> 安全渲染');
 assert.equal(prepareVisualMarkdown('React <mark class="test"> 安全渲染'),'React <mark class="test"> 安全渲染');
 assert.equal(prepareVisualMarkdown('<mark>独立未闭合'),'\u003cmark>独立未闭合');
 assert.equal(prepareVisualMarkdown('React <mark> A\n\nOther </mark> B'),'React <mark> A\n\nOther </mark> B');
 assert.equal(prepareVisualMarkdown('```html\n<mark>\n```'),'```html\n<mark>\n```');
 assert.equal(markdownRoundTripSafe('React <mark class="x">text','React text'),false);
});
