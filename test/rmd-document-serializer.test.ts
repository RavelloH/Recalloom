import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Fragment, Schema, type Mark, type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {createRmdVisualDocumentSerializer} from '../web/src/visual-editor/document-serializer';

const schema=new Schema({
 nodes:{
  doc:{content:'block+'},
  paragraph:{group:'block',content:'inline*',attrs:{blockId:{default:null}}},
  heading:{group:'block',content:'inline*',attrs:{level:{default:1},id:{default:null}}},
  codeBlock:{group:'block',content:'text*',attrs:{language:{default:''},filename:{default:null},wrap:{default:null},expand:{default:null},id:{default:null}}},
  blockMath:{group:'block',atom:true,attrs:{latex:{default:''},equationId:{default:null}}},
  richContainer:{group:'block',content:'block*',attrs:{kind:{default:'warning'},title:{default:''},id:{default:null}}},
  blockquote:{group:'block',content:'block+'},
  bulletList:{group:'block',content:'listItem+'},
  orderedList:{group:'block',content:'listItem+',attrs:{start:{default:1}}},
  listItem:{content:'block+'},
  table:{group:'block',content:'tableRow+',attrs:{tableId:{default:null},caption:{default:null}}},
  tableRow:{content:'(tableCell|tableHeader)+'},
  tableCell:{content:'block+',attrs:{colspan:{default:1},rowspan:{default:1},colwidth:{default:null},textAlign:{default:null}}},
  tableHeader:{content:'block+',attrs:{colspan:{default:1},rowspan:{default:1},colwidth:{default:null},textAlign:{default:null}}},
  image:{inline:true,group:'inline',atom:true,attrs:{src:{default:''},alt:{default:''},title:{default:null},figureId:{default:null},width:{default:null},height:{default:null},caption:{default:null}}},
  inlineMath:{inline:true,group:'inline',atom:true,attrs:{latex:{default:''}}},
  hardBreak:{inline:true,group:'inline'},
  text:{group:'inline'},
 },
 marks:{
  bold:{},italic:{},link:{attrs:{href:{default:''},title:{default:null}}},
  rmdMark:{},rmdSketch:{attrs:{kind:{default:'highlight'},color:{default:null},stroke:{default:null},padding:{default:null},roughness:{default:null},opacity:{default:null}}}
 }
});

const text=(value:string,marks?:readonly Mark[])=>schema.text(value,marks);
const paragraph=(value:string,attrs:Record<string,unknown>={},marks?:readonly Mark[])=>
 schema.node('paragraph',attrs,value?[text(value,marks)]:[]);
const document=(...blocks:ProseMirrorNode[])=>schema.node('doc',null,blocks);
const replaceChild=(parent:ProseMirrorNode,index:number,replacement:ProseMirrorNode)=>{
 const children:ProseMirrorNode[]=[];
 parent.forEach((child,_offset,childIndex)=>children.push(childIndex===index?replacement:child));
 return parent.copy(Fragment.fromArray(children));
};
const canonical=(node:ProseMirrorNode)=>serializeRmdVisual(node.toJSON());

test('cached output matches the canonical serializer for rich nested blocks',()=>{
 const serializer=createRmdVisualDocumentSerializer();
 const source=document(
  schema.node('heading',{level:2,id:'chapter-one'},[text('Overview')]),
  paragraph('A marked paragraph',{},[schema.mark('bold')]),
  schema.node('richContainer',{kind:'warning',title:'Read first'},[
   paragraph('Nested note'),
   schema.node('bulletList',null,[schema.node('listItem',null,[paragraph('First'),schema.node('orderedList',{start:3},[
    schema.node('listItem',null,[paragraph('Nested item')])
   ])])])
  ]),
  schema.node('table', {tableId:'tbl-results',caption:'Results'},[
   schema.node('tableRow',null,[
    schema.node('tableHeader',null,[paragraph('Input')]),
    schema.node('tableCell',null,[paragraph('Output',{},[schema.mark('rmdSketch',{kind:'underline',color:'#ff0000'})])])
   ])
  ]),
  schema.node('paragraph',null,[text('Energy '),schema.node('inlineMath',{latex:'E=mc^2'})]),
  schema.node('blockMath',{latex:'a^2+b^2=c^2',equationId:'eq-pythagorean'}),
  schema.node('codeBlock',{language:'ts',filename:'sum.ts',id:'code-sum'},[text('const sum = 1 + 2;')]),
  schema.node('paragraph',null,[schema.node('image',{src:'https://example.org/figure.png',alt:'Figure',figureId:'fig-example'})])
 );

 assert.equal(serializer(source),canonical(source));
});

test('reuses unchanged top-level block serialization and the last document result',()=>{
 let calls=0;
 const serializer=createRmdVisualDocumentSerializer(block=>{
  calls++;
  return serializeRmdVisual(schema.node('doc',null,[block]).toJSON());
 });
 const blocks=Array.from({length:7},(_,i)=>paragraph('Paragraph '+i,{blockId:'paragraph-'+i}));
 const original=document(...blocks);
 const originalOutput=canonical(original);

 assert.equal(serializer(original),originalOutput);
 assert.equal(calls,blocks.length);
 assert.equal(serializer(original),originalOutput);
 assert.equal(calls,blocks.length);

 let changedBlockSerializations=0;
 for(const index of [0,3,6]){
  const changedBlock=paragraph('Edited '+index,{blockId:'paragraph-'+index});
  const edited=replaceChild(original,index,changedBlock);
  assert.equal(serializer(edited),canonical(edited));
  changedBlockSerializations++;
  assert.equal(calls,blocks.length+changedBlockSerializations);
 }
 assert.equal(serializer(original),originalOutput);
 assert.equal(calls,blocks.length+changedBlockSerializations);
});

test('nested edits invalidate their containing block; reorder, deletion, empty blocks and undo remain canonical',()=>{
 let calls=0;
 const serializer=createRmdVisualDocumentSerializer(block=>{
  calls++;
  return serializeRmdVisual(schema.node('doc',null,[block]).toJSON());
 });
 const first=paragraph('Keep');
 const container=schema.node('richContainer',{kind:'tip'},[paragraph('Before'),schema.node('blockquote',null,[paragraph('Quoted')])]);
 const empty=paragraph('');
 const last=paragraph('Tail');
 const original=document(first,container,empty,last);
 const originalOutput=canonical(original);

 assert.equal(serializer(original),originalOutput);
 assert.equal(calls,4);

 const editedContainer=replaceChild(container,0,paragraph('After'));
 const nestedEdit=replaceChild(original,1,editedContainer);
 assert.equal(serializer(nestedEdit),canonical(nestedEdit));
 assert.equal(calls,5);

 const reordered=document(last,editedContainer,first,empty);
 assert.equal(serializer(reordered),canonical(reordered));
 assert.equal(calls,5);

 const deleted=document(last,editedContainer,first);
 assert.equal(serializer(deleted),canonical(deleted));
 assert.equal(calls,5);
 assert.equal(serializer(original),originalOutput);
 assert.equal(calls,5);
});
