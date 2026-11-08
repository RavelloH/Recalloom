import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {BlockMathWithHighlight} from '../web/src/tiptap/block-math-highlight';
import {CrossReferenceNode} from '../web/src/tiptap/cross-reference';
import {RichImage} from '../web/src/tiptap/rich-image';
import {RawMarkdown} from '../web/src/tiptap/raw-markdown';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {collectCrossRefs,crossRefToken,parseEquationId,validCrossRefId} from '../web/src/cross-reference';
import {parseFigureSuffix,serializeFigureSuffix} from '../web/src/figure-syntax';
import type {JSONContent} from '@tiptap/core';

const manager=new MarkdownManager({extensions:[
 StarterKit,Markdown,BlockMathWithHighlight,RichImage.configure({allowBase64:false}),CrossReferenceNode,RawMarkdown
]});
function nodes(tree:JSONContent,type:string):JSONContent[]{
 const result:JSONContent[]=[];
 const walk=(node:JSONContent)=>{if(node.type===type)result.push(node);for(const child of node.content??[])walk(child);};
 walk(tree);return result;
}
describe('Markdown-first explicit references',()=>{
 it('accepts typed fig/eq/tbl IDs and rejects unsafe or malformed IDs',()=>{
  for(const id of ['fig-diagram','eq-power','tbl-params'])assert.ok(validCrossRefId(id),id);
  for(const id of ['my-id','fig-','fig-../x','eq-A@B','eq-999','fig-x'.repeat(40)])assert.equal(validCrossRefId(id),false,id);
  assert.deepEqual(crossRefToken('@eq-power。'),{type:'crossReference',raw:'@eq-power',target:'eq-power'});
  assert.equal(crossRefToken('user@eq-power'),undefined);
 });
 it('keeps bounded figure presentation attrs and stable ID in the Markdown source',()=>{
  const attr=parseFigureSuffix('{#fig-circuit width=480 caption="电路结构"}');
  assert.deepEqual(attr,{width:480,height:null,caption:'电路结构',id:'fig-circuit'});
  assert.equal(serializeFigureSuffix(attr!),'{#fig-circuit width=480 caption="电路结构"}');
  assert.equal(parseFigureSuffix('{#fig-Circuit width=99999}'),null);
  const source='![电路](https://example.com/c.png){#fig-circuit width=480 caption="电路结构"}';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'image')[0]?.attrs?.figureId,'fig-circuit',JSON.stringify(doc));
  assert.equal(manager.serialize(doc),source);
 });
 it('parses blockMath closing-fence IDs and preserves numbered equations on roundtrip',()=>{
  const source='$$\nP=UI\n$$ {#eq-power}';
  assert.deepEqual(parseEquationId(source),{latex:'P=UI',id:'eq-power'});
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'blockMath')[0]?.attrs?.equationId,'eq-power',JSON.stringify(doc));
  assert.equal(manager.serialize(doc),source);
  assert.ok(!parseEquationId('$$\nP=UI\n$$ {#eq-invalid!}'));
 });
 it('renders the same dynamic labels on references without storing numbers in the Markdown',()=>{
  const source=[
   '![图 A](https://example.com/a.png){#fig-a caption="A"}',
   '',
   '$$\nx=1\n$$ {#eq-one}',
   '',
   '参考 @fig-a、@eq-one、@tbl-missing。',
   '',
   '![图 B](https://example.com/b.png){#fig-b caption="B"}'
  ].join('\n');
  const doc=buildVisualMarkdown(source,manager);
  const tokens=nodes(doc,'crossReference');
  assert.deepEqual(tokens.map(t=>t.attrs?.target),['fig-a','eq-one','tbl-missing'],JSON.stringify(doc));
  const index=collectCrossRefs(doc);
  assert.equal(index.get('fig-a')?.label,'图 1');
  assert.equal(index.get('fig-b')?.label,'图 2');
  assert.equal(index.get('eq-one')?.label,'公式 1');
  assert.equal(index.get('tbl-missing'),undefined);
  const md=manager.serialize(doc);
  assert.ok(md.includes('@fig-a')&&md.includes('@eq-one')&&md.includes('@tbl-missing'));
  assert.equal(nodes(buildVisualMarkdown(md,manager),'crossReference').length,3);
 });
 it('numbers only distinct typed definitions and updates after moves without persistent indexes',()=>{
  const doc:JSONContent={type:'doc',content:[
   {type:'image',attrs:{figureId:'fig-b'}},
   {type:'image',attrs:{figureId:'fig-a'}},
   {type:'image',attrs:{figureId:'fig-b'}},
   {type:'blockMath',attrs:{equationId:'eq-x'}},
   {type:'table',attrs:{tableId:'tbl-a'}}
  ]};
  const index=collectCrossRefs(doc);
  assert.equal(index.get('fig-b')?.label,'图 1');
  assert.equal(index.get('fig-a')?.label,'图 2');
  assert.equal(index.get('eq-x')?.label,'公式 1');
  assert.equal(index.get('tbl-a')?.label,'表 1');
  assert.equal(index.size,4);
 });
});
