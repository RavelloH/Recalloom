import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Schema} from '@tiptap/pm/model';
import {EditorState} from '@tiptap/pm/state';
import {crossReferencesMayChange} from '../web/src/tiptap/cross-reference-update';

const schema=new Schema({
 nodes:{
  doc:{content:'block+'},
  paragraph:{group:'block',content:'inline*',attrs:{blockId:{default:null}}},
  heading:{group:'block',content:'inline*',attrs:{id:{default:null}}},
  codeBlock:{group:'block',content:'text*',attrs:{id:{default:null}}},
  blockMath:{group:'block',attrs:{equationId:{default:null}}},
  image:{inline:true,group:'inline',attrs:{figureId:{default:null}}},
  text:{group:'inline'}
 }
});
const paragraph=(text:string,id?:string)=>schema.node('paragraph',{blockId:id??null},text?[schema.text(text)]:[]);
const heading=(text:string,id?:string)=>schema.node('heading',{id:id??null},text?[schema.text(text)]:[]);
const state=(...blocks:ReturnType<typeof paragraph>[])=>EditorState.create({schema,doc:schema.node('doc',null,blocks)});

test('ordinary paragraph typing does not invalidate the cross-reference index',()=>{
 const a=state(heading('Chapter','chapter-one'),paragraph('Plain text'),heading('Later','chapter-two'));
 const position=a.doc.child(0).nodeSize+3;
 assert.equal(crossReferencesMayChange(a.tr.insertText('x',position)),false);
 assert.equal(crossReferencesMayChange(a.tr.setSelection(a.selection)),false);
});

test('heading edits and removal of a referenced node invalidate labels',()=>{
 const a=state(heading('Chapter','chapter-one'),paragraph('Plain text'));
 assert.equal(crossReferencesMayChange(a.tr.insertText('X',2)),true);
 assert.equal(crossReferencesMayChange(a.tr.delete(0,a.doc.child(0).nodeSize)),true);
});

test('adding or removing an anchor refreshes the index',()=>{
 const a=state(paragraph('Hello'));
 assert.equal(crossReferencesMayChange(a.tr.setNodeMarkup(0,undefined,{blockId:'paragraph-one'})),true);
 const b=state(paragraph('Hello','paragraph-one'));
 assert.equal(crossReferencesMayChange(b.tr.setNodeMarkup(0,undefined,{blockId:null})),true);
});

test('new image references and complex multi-step transactions refresh conservatively',()=>{
 const a=state(paragraph('plain'));
 const insert=a.tr.insert(2,schema.node('image',{figureId:'fig-device'}));
 assert.equal(crossReferencesMayChange(insert),true);
 const combined=a.tr.insertText('X',2).insertText('Y',3);
 assert.equal(crossReferencesMayChange(combined),true);
});
