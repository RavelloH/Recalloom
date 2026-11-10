import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {Schema} from '@tiptap/pm/model';
import {EditorState} from '@tiptap/pm/state';
import {
 editableBlockAt,editableBlockFromDocumentPosition,blockSiblings,
 blockCanReorder,blockCanDuplicate,blockCanDelete,
 moveBlockBy,moveBlockTo,duplicateBlock,removeBlock,topLevelBlocks
} from '../web/src/tiptap/editor-block-actions';

const schema=new Schema({nodes:{
 doc:{content:'block+'},
 paragraph:{group:'block',content:'text*',attrs:{blockId:{default:null}}},
 richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},title:{default:''},sender:{default:null}}},
 text:{group:'inline'}
}});
const node=(kind:string,title:string,children:any[])=>
 schema.nodes.richContainer.create({kind,title},children);
const paragraph=(value:string)=>schema.nodes.paragraph.create(null,schema.text(value));
function build(){
 const doc=schema.nodes.doc.create(null,[
  node('chat','Conversation',[
   node('message','Alice',[paragraph('A')]),
   node('message','Bob',[paragraph('B')]),
   node('message','Carol',[paragraph('C')])
  ]),
  node('tabs','Tabs',[
   node('tab','First',[paragraph('Tab 1')]),
   node('tab','Second',[paragraph('Tab 2')])
  ]),
  node('flashcard','Flash',[node('front','Front',[paragraph('Q')]),node('back','Back',[paragraph('A')])]),
  node('glossary','Glossary',[node('definition','Word',[paragraph('Definition')])])
 ]);
 let state=EditorState.create({schema,doc});
 const editor={get state(){return state},view:{dispatch(tr:any){state=state.apply(tr)}}} as unknown as Editor;
 const find=(kind:string)=>{const result:number[]=[];state.doc.descendants((node,pos)=>{if(node.type.name==='richContainer'&&node.attrs.kind===kind)result.push(pos)});return result};
 const titles=(kind:string)=>find(kind).map(pos=>state.doc.nodeAt(pos)?.attrs.title);
 return {editor,find,titles,get state(){return state}};
}
describe('nested RMD structural block operations',()=>{
 it('resolves only legally attached child containers and targets their own boundaries',()=>{
  const d=build(),message=d.find('message')[1]!;
  const block=editableBlockAt(d.editor,message);
  assert.equal(block?.node.attrs.title,'Bob');
  assert.equal(block?.parentKind,'chat');
  assert.equal(block?.parentPos,d.find('chat')[0]);
  assert.equal(editableBlockFromDocumentPosition(d.editor,message+3)?.pos,message);
  assert.equal(blockSiblings(d.editor,message).length,3);
  assert.equal(topLevelBlocks(d.editor).length,4);
  assert.equal(editableBlockAt(d.editor,message+1),null);
 });
 it('moves messages only among legal siblings and supports reversible order operations',()=>{
  const d=build(),messages=d.find('message');
  assert.equal(moveBlockBy(d.editor,messages[0]!,-1),false);
  assert.equal(moveBlockBy(d.editor,messages[0]!,1),true);
  assert.deepEqual(d.titles('message'),['Bob','Alice','Carol']);
  const now=d.find('message');
  assert.equal(moveBlockTo(d.editor,now[0]!,now[2]!,true),true);
  assert.deepEqual(d.titles('message'),['Alice','Carol','Bob']);
  assert.equal(moveBlockTo(d.editor,d.find('message')[0]!,d.find('tab')[0]!),false,'cannot move between chat and tabs');
  assert.equal(moveBlockTo(d.editor,d.find('message')[0]!,d.find('message')[0]!),false,'self drop');
 });
 it('duplicates safely and refuses to delete the last required child',()=>{
  const d=build();
  assert.equal(duplicateBlock(d.editor,d.find('message')[0]!),true);
  assert.deepEqual(d.titles('message'),['Alice','Alice','Bob','Carol']);
  assert.equal(removeBlock(d.editor,d.find('message')[1]!),true);
  assert.deepEqual(d.titles('message'),['Alice','Bob','Carol']);
  assert.equal(duplicateBlock(d.editor,d.find('definition')[0]!),true);
  assert.deepEqual(d.titles('definition'),['Word','Word']);
  assert.equal(removeBlock(d.editor,d.find('definition')[1]!),true);
  assert.equal(removeBlock(d.editor,d.find('definition')[0]!),false,'must preserve final definition');
 });
 it('protects unique flashcard front/back from movement, duplication or deletion',()=>{
  const d=build();
  for(const kind of ['front','back']){
   const pos=d.find(kind)[0]!;
   assert.ok(editableBlockAt(d.editor,pos),'still inspectable: '+kind);
   assert.equal(blockCanReorder(d.editor,pos),false);
   assert.equal(blockCanDuplicate(d.editor,pos),false);
   assert.equal(blockCanDelete(d.editor,pos),false);
   assert.equal(moveBlockBy(d.editor,pos,1),false);
   assert.equal(duplicateBlock(d.editor,pos),false);
   assert.equal(removeBlock(d.editor,pos),false);
  }
  assert.equal(d.titles('front').length,1);
  assert.equal(d.titles('back').length,1);
 });
});