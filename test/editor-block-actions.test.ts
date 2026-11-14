import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {Schema,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {EditorState,type Transaction} from '@tiptap/pm/state';
import {history,undo,redo} from '@tiptap/pm/history';
import {duplicateBlock,mapBlockEditorTarget,moveBlockBy,moveBlockTo,removeBlock,topLevelBlocks,withoutBlockIdentity} from '../web/src/tiptap/editor-block-actions';

const schema=new Schema({
 nodes:{
  doc:{content:'block+'},
  paragraph:{group:'block',content:'text*',attrs:{blockId:{default:null}}},
  richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},title:{default:''}}},
  image:{group:'block',atom:true,attrs:{src:{default:''},alt:{default:''}}},
  text:{group:'inline'}
 }
});

describe('inspected block anchors',()=>{
 const paragraph=(text:string)=>schema.nodes.paragraph.create(null,schema.text(text));
 function inspected(first:ProseMirrorNode=paragraph('A')){
  let state=EditorState.create({schema,plugins:[history()],doc:schema.nodes.doc.create(null,[first,paragraph('B')])});
  const editor={get state(){return state}} as Editor;
  let target:{pos:number;node:typeof state.doc}|null={pos:0,node:state.doc.firstChild!};
  const dispatch=(tr:Transaction)=>{
   state=state.apply(tr);
   if(target)target=mapBlockEditorTarget(editor,tr,target.pos,target.node);
  };
  return {editor,dispatch,get target(){return target;}};
 }
 it('keeps the inspected block through a panel replacement and its undo/redo',()=>{
  const d=inspected();
  d.dispatch(d.editor.state.tr.replaceWith(0,3,paragraph('Longer content')).setMeta('rk-block-panel-edit',true));
  assert.equal(d.target?.node.textContent,'Longer content');
  assert.equal(undo(d.editor.state,d.dispatch),true);
  assert.equal(d.target?.node.textContent,'A');
  assert.equal(redo(d.editor.state,d.dispatch),true);
  assert.equal(d.target?.node.textContent,'Longer content');
 });
 it('follows insertion before the block and undo without adopting the new sibling',()=>{
  const d=inspected();
  d.dispatch(d.editor.state.tr.insert(0,paragraph('Before')));
  assert.equal(d.target?.node.textContent,'A');
  assert.equal(d.target?.pos,8);
  undo(d.editor.state,d.dispatch);
  assert.equal(d.target?.node.textContent,'A');
  assert.equal(d.target?.pos,0);
 });
 it('closes for a deleted block and an unrelated replacement of the same type',()=>{
  const removed=inspected();
  removed.dispatch(removed.editor.state.tr.delete(0,3));
  assert.equal(removed.target,null);
  const replaced=inspected();
  replaced.dispatch(replaced.editor.state.tr.replaceWith(0,3,paragraph('External replacement')));
  assert.equal(replaced.target,null);
 });
 it('keeps native container title edits anchored without panel metadata',()=>{
  const d=inspected(schema.nodes.richContainer.create({kind:'note',title:'Before'},paragraph('Body')));
  d.dispatch(d.editor.state.tr.setNodeMarkup(0,undefined,{kind:'note',title:'After'}));
  assert.equal(d.target?.node.attrs.title,'After');
  assert.equal(d.target?.node.textContent,'Body');
 });
 it('keeps native image property edits anchored without accepting unrelated replacements',()=>{
  const d=inspected(schema.nodes.image.create({src:'/before.png',alt:'Before'}));
  d.dispatch(d.editor.state.tr.setNodeMarkup(0,undefined,{src:'/after.png',alt:'After'}));
  assert.equal(d.target?.node.attrs.src,'/after.png');
  assert.equal(d.target?.node.attrs.alt,'After');
 });
});
function build(labels:string[]){
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,labels.map((label,i)=>
  schema.nodes.paragraph.create({blockId:'id-'+i},schema.text(label))))});
 const fake={get state(){return state},view:{dispatch(tr:any){state=state.apply(tr)}}} as unknown as Editor;
 return {editor:fake,values:()=>state.doc.content.content.map(node=>node.textContent),
  ids:()=>state.doc.content.content.map(node=>node.attrs.blockId)};
}
describe('top-level document block transactions',()=>{
 it('moves a block up or down without changing any payload',()=>{
  const d=build(['A','B','C']);
  const blocks=topLevelBlocks(d.editor);
  assert.equal(moveBlockBy(d.editor,blocks[0]!.pos,-1),false);
  assert.equal(moveBlockBy(d.editor,blocks[0]!.pos,1),true);
  assert.deepEqual(d.values(),['B','A','C']);
  assert.deepEqual(d.ids(),['id-1','id-0','id-2']);
  assert.equal(moveBlockBy(d.editor,topLevelBlocks(d.editor)[1]!.pos,-1),true);
  assert.deepEqual(d.values(),['A','B','C']);
 });
 it('supports non-adjacent drag reorder and refuses self-drop',()=>{
  const d=build(['A','B','C','D']);
  let blocks=topLevelBlocks(d.editor);
  assert.equal(moveBlockTo(d.editor,blocks[0]!.pos,blocks[3]!.pos,true),true);
  assert.deepEqual(d.values(),['B','C','D','A']);
  blocks=topLevelBlocks(d.editor);
  assert.equal(moveBlockTo(d.editor,blocks[3]!.pos,blocks[0]!.pos,false),true);
  assert.deepEqual(d.values(),['A','B','C','D']);
  assert.equal(moveBlockTo(d.editor,0,0),false);
 });
 it('duplicates content but clears block/child stable IDs',()=>{
  const d=build(['A','B']);
  assert.equal(duplicateBlock(d.editor,0),true);
  assert.deepEqual(d.values(),['A','A','B']);
  assert.deepEqual(d.ids(),['id-0',null,'id-1']);
  const json={type:'richContainer',attrs:{kind:'note',id:'caption'},content:[
   {type:'paragraph',attrs:{blockId:'para-1'},content:[{type:'text',text:'X'}]},
   {type:'richContainer',attrs:{kind:'info',figureId:'figure-1'},content:[{type:'paragraph'}]}
  ]};
  const cleaned=withoutBlockIdentity(json);
  assert.equal(cleaned.attrs?.id,null);
  assert.equal(cleaned.content?.[0]?.attrs?.blockId,null);
  assert.equal(cleaned.content?.[1]?.attrs?.figureId,null);
  assert.equal(json.attrs.id,'caption','source JSON unchanged');
 });
 it('keeps a valid empty paragraph after removing the final block',()=>{
  const d=build(['Only']);
  assert.equal(removeBlock(d.editor,0),true);
  assert.deepEqual(d.values(),['']);
  assert.equal(d.editor.state.doc.childCount,1);
  const two=build(['A','B']);
  assert.equal(removeBlock(two.editor,0),true);
  assert.deepEqual(two.values(),['B']);
  assert.equal(removeBlock(two.editor,999),false);
 });
});
