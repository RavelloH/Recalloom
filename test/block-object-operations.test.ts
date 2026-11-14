import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {Schema,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {EditorState} from '@tiptap/pm/state';
import {history,undo,redo} from '@tiptap/pm/history';
import {createRemoveBlockObjectTransaction,createMathTypeTransaction} from '../web/src/tiptap/block-object-operations';

const schema=new Schema({nodes:{
 doc:{content:'block+'},text:{group:'inline'},
 paragraph:{group:'block',content:'inline*',attrs:{id:{default:null},blockId:{default:null}}},
 inlineMath:{group:'inline',inline:true,atom:true,attrs:{latex:{default:''}}},
 inlineWrapper:{group:'inline',inline:true,content:'text*',attrs:{id:{default:null}}},
 blockMath:{group:'block',atom:true,attrs:{latex:{default:''},equationId:{default:null},id:{default:null},blockId:{default:null}}},
 image:{group:'block',atom:true,attrs:{src:{default:''}}},
 container:{group:'block',content:'block+'},
 paragraphOnly:{group:'block',content:'paragraph'},
 mathOnly:{group:'block',content:'blockMath'}
},marks:{bold:{},italic:{}}});
const inline=(latex='x')=>schema.nodes.inlineMath.create({latex});
const math=(latex='x',equationId:string|null='eq-test')=>schema.nodes.blockMath.create({latex,equationId});
const paragraph=(content:ProseMirrorNode|ProseMirrorNode[]|null=null,attrs={})=>schema.nodes.paragraph.create(attrs,content);
function build(children:ProseMirrorNode[]){
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,children),plugins:[history()]});
 const editor={get state(){return state},view:{dispatch(tr:any){state=state.apply(tr);}}} as unknown as Editor;
 return editor;
}
describe('exact block object operations',()=>{
 it('splits inline math while preserving text, marks and only one copy of root IDs',()=>{
  const bold=schema.marks.bold.create(),italic=schema.marks.italic.create();
  const editor=build([paragraph([schema.text('Before',[bold]),inline(),schema.text('After',[italic])],{id:'section',blockId:'para'})]);
  const converted=createMathTypeTransaction(editor,7,'block');
  editor.view.dispatch(converted.transaction);
  const [before,block,after]=editor.state.doc.content.content;
  assert.equal(before!.textContent,'Before');assert.equal(after!.textContent,'After');
  assert.deepEqual(before!.firstChild!.marks,[bold]);assert.deepEqual(after!.firstChild!.marks,[italic]);
  assert.equal(before!.attrs.blockId,'para');assert.equal(before!.attrs.id,'section');
  assert.equal(after!.attrs.blockId,null);assert.equal(after!.attrs.id,null);
  assert.equal(block!.type.name,'blockMath');assert.equal(converted.pos,before!.nodeSize);
  assert.equal(undo(editor.state,editor.view.dispatch),true);
  assert.equal(editor.state.doc.childCount,1);assert.equal(editor.state.doc.firstChild!.childCount,3);
  assert.equal(redo(editor.state,editor.view.dispatch),true);assert.equal(editor.state.doc.childCount,3);
 });
 it('retains the original paragraph identity on the sole surviving fragment',()=>{
  const editor=build([paragraph([inline(),schema.text('After')],{blockId:'first'})]);
  editor.view.dispatch(createMathTypeTransaction(editor,1,'block').transaction);
  assert.equal(editor.state.doc.childCount,2);assert.equal(editor.state.doc.lastChild!.attrs.blockId,'first');
  const only=build([paragraph(inline(),{blockId:'anchored'})]);
  only.view.dispatch(createMathTypeTransaction(only,1,'block').transaction);
  assert.equal(only.state.doc.firstChild!.type.name,'paragraph');assert.equal(only.state.doc.firstChild!.attrs.blockId,'anchored');
 });
 it('converts block math to an inline paragraph and preserves untouched siblings',()=>{
  const before=paragraph(schema.text('Before')),after=paragraph(schema.text('After'));
  const editor=build([before,math(),after]);
  const converted=createMathTypeTransaction(editor,before.nodeSize,'inline');
  editor.view.dispatch(converted.transaction);
  assert.equal(editor.state.doc.firstChild,before);assert.equal(editor.state.doc.lastChild,after);
  const node=editor.state.doc.child(1).firstChild!;
  assert.equal(node.type.name,'inlineMath');assert.equal(node.attrs.latex,'x');assert.equal(node.attrs.equationId,undefined);
  assert.equal(editor.state.doc.nodeAt(converted.pos),node);
 });
 it('retains descendant identities and carries compatible block anchors to the new paragraph',()=>{
  const wrapper=schema.nodes.inlineWrapper.create({id:'child-id'},schema.text('After'));
  const editor=build([paragraph([schema.text('Before'),inline(),wrapper],{blockId:'parent-id'})]);
  editor.view.dispatch(createMathTypeTransaction(editor,7,'block').transaction);
  assert.equal(editor.state.doc.lastChild!.attrs.blockId,null);
  assert.equal(editor.state.doc.lastChild!.firstChild!.attrs.id,'child-id');
  const anchored=build([schema.nodes.blockMath.create({latex:'x',equationId:'eq-old',id:'anchor',blockId:'block-anchor'})]);
  anchored.view.dispatch(createMathTypeTransaction(anchored,0,'inline').transaction);
  assert.equal(anchored.state.doc.firstChild!.attrs.id,'anchor');
  assert.equal(anchored.state.doc.firstChild!.attrs.blockId,'block-anchor');
  assert.equal(anchored.state.doc.firstChild!.firstChild!.attrs.equationId,undefined);
 });
 it('removes only nested objects and fills an otherwise required parent',()=>{
  for(const object of [math(),schema.nodes.image.create({src:'/image.png'})]){
   const container=schema.nodes.container.create(null,object),editor=build([container]);
   editor.view.dispatch(createRemoveBlockObjectTransaction(editor,1));
   assert.equal(editor.state.doc.firstChild!.type.name,'container');
   assert.equal(editor.state.doc.firstChild!.firstChild!.type.name,'paragraph');
   undo(editor.state,editor.view.dispatch);assert.ok(editor.state.doc.firstChild!.firstChild!.eq(object));
  }
  const editor=build([paragraph([schema.text('Before'),inline(),schema.text('After')],{blockId:'keep'})]);
  editor.view.dispatch(createRemoveBlockObjectTransaction(editor,7));
  assert.equal(editor.state.doc.firstChild!.textContent,'BeforeAfter');assert.equal(editor.state.doc.firstChild!.attrs.blockId,'keep');
 });
 it('keeps a valid paragraph after deleting the sole root object',()=>{
  const editor=build([math()]);editor.view.dispatch(createRemoveBlockObjectTransaction(editor,0));
  assert.equal(editor.state.doc.childCount,1);assert.equal(editor.state.doc.firstChild!.type.name,'paragraph');
 });
 it('refuses constrained parents without removing or fitting away content',()=>{
  const editor=build([schema.nodes.paragraphOnly.create(null,paragraph([schema.text('Before'),inline(),schema.text('After')]))]);
  const original=editor.state.doc;
  assert.throws(()=>createMathTypeTransaction(editor,8,'block'),/父容器/);
  assert.equal(editor.state.doc,original);
  const required=build([schema.nodes.mathOnly.create(null,math())]);
  assert.throws(()=>createRemoveBlockObjectTransaction(required,1),/父容器/);
  assert.throws(()=>createMathTypeTransaction(required,1,'inline'),/父容器/);
 });
 it('rejects unsupported targets and multiline inline formulas',()=>{
  const editor=build([paragraph(schema.text('Text')),math('x\ny')]);
  assert.throws(()=>createRemoveBlockObjectTransaction(editor,0),/只支持/);
  assert.throws(()=>createMathTypeTransaction(editor,6,'inline'),/公式/);
 });
});
