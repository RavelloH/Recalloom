import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {Schema} from '@tiptap/pm/model';
import {EditorState} from '@tiptap/pm/state';
import {duplicateBlock,moveBlockBy,moveBlockTo,removeBlock,topLevelBlocks,withoutBlockIdentity} from '../web/src/tiptap/editor-block-actions';

const schema=new Schema({
 nodes:{
  doc:{content:'block+'},
  paragraph:{group:'block',content:'text*',attrs:{blockId:{default:null}}},
  richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},title:{default:''}}},
  text:{group:'inline'}
 }
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
