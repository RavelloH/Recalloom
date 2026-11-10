import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {Schema,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {
 describeRmdAnchorConflict,findRmdAnchorConflict,findRmdAnchorConflictForNode
} from '../web/src/tiptap/rmd-anchor-ids';

const schema=new Schema({nodes:{
 doc:{content:'block+'},
 paragraph:{group:'block',content:'inline*',attrs:{blockId:{default:null}}},
 heading:{group:'block',content:'inline*',attrs:{id:{default:null}}},
 math:{group:'block',content:'text*',attrs:{equationId:{default:null}}},
 table:{group:'block',content:'block+',attrs:{tableId:{default:null}}},
 codeBlock:{group:'block',content:'text*',attrs:{id:{default:null}}},
 richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},id:{default:null}}},
 image:{inline:true,group:'inline',atom:true,attrs:{figureId:{default:null}}},
 richFootnoteRef:{inline:true,group:'inline',atom:true,attrs:{id:{default:null}}},
 text:{group:'inline'}
}});
const text=(value:string)=>schema.text(value);
const paragraph=(value:string,id:string|null=null)=>schema.nodes.paragraph.create({blockId:id},text(value));
const heading=(value:string,id:string|null)=>schema.nodes.heading.create({id},text(value));
function document(){
 return schema.nodes.doc.create(null,[
  heading('Existing heading','shared-anchor'),
  paragraph('Existing paragraph','paragraph-one'),
  schema.nodes.math.create({equationId:'eq-power'},text('P=UI')),
  schema.nodes.table.create({tableId:'tbl-data'},[paragraph('Cell')]),
  schema.nodes.codeBlock.create({id:'code-sample'},text('const x = 1;')),
  schema.nodes.paragraph.create(null,[
   text('Figure '),schema.nodes.image.create({figureId:'fig-device'}),
   text(' Footnote '),schema.nodes.richFootnoteRef.create({id:'note-reference'})
  ]),
  schema.nodes.richContainer.create({kind:'warning',id:'container-one'},[
   paragraph('Nested paragraph','nested-paragraph')
  ])
 ]);
}
function positionOf(doc:ProseMirrorNode,predicate:(node:ProseMirrorNode)=>boolean){
 let found=-1;doc.descendants((node,pos)=>{if(found<0&&predicate(node))found=pos;});return found;
}
describe('document-wide stable RMD anchor uniqueness',()=>{
 it('indexes every stable anchor family and ignores non-anchor IDs such as footnote references',()=>{
  const doc=document();
  for(const id of ['shared-anchor','paragraph-one','eq-power','tbl-data','code-sample','fig-device','container-one','nested-paragraph'])
   assert.ok(findRmdAnchorConflict(doc,id),id+' should be globally indexed');
  assert.equal(findRmdAnchorConflict(doc,'note-reference'),null,'footnote IDs are local references, not document anchors');
  assert.equal(findRmdAnchorConflict(doc,'missing'),null);
 });
 it('compares IDs case-insensitively across different block families',()=>{
  const conflict=findRmdAnchorConflict(document(),'SHARED-ANCHOR');
  assert.deepEqual(conflict&&{id:conflict.id,label:conflict.label},{id:'shared-anchor',label:'标题'});
  assert.ok(findRmdAnchorConflict(document(),'CONTAINER-ONE')?.label.includes('warning'));
 });
 it('excludes the complete edited node subtree but still detects collisions elsewhere',()=>{
  const doc=document();
  const pos=positionOf(doc,node=>node.type.name==='richContainer'&&node.attrs.kind==='warning');
  const current=doc.nodeAt(pos)!;
  assert.equal(findRmdAnchorConflict(doc,'container-one',{pos,nodeSize:current.nodeSize}),null);
  assert.equal(findRmdAnchorConflict(doc,'nested-paragraph',{pos,nodeSize:current.nodeSize}),null);
  assert.equal(findRmdAnchorConflict(doc,'shared-anchor',{pos,nodeSize:current.nodeSize})?.label,'标题');
 });
 it('validates a candidate against other blocks and catches duplicates inside nested content',()=>{
  const doc=document();
  const pos=positionOf(doc,node=>node.type.name==='richContainer'&&node.attrs.kind==='warning');
  const sameId=schema.nodes.richContainer.create({kind:'warning',id:'container-one'},[paragraph('Changed','nested-paragraph')]);
  assert.equal(findRmdAnchorConflictForNode(doc,sameId,pos),null,'unchanged anchors do not block ordinary content edits');
  const external=schema.nodes.richContainer.create({kind:'warning',id:'SHARED-ANCHOR'},[paragraph('Changed')]);
  const conflict=findRmdAnchorConflictForNode(doc,external,pos);
  assert.equal(conflict?.source,'document');
  assert.equal(conflict?.id,'shared-anchor');
  assert.match(describeRmdAnchorConflict(conflict!),/标题/);
  const internal=schema.nodes.richContainer.create({kind:'warning',id:'fresh-id'},[paragraph('Nested','fresh-id')]);
  const duplicate=findRmdAnchorConflictForNode(doc,internal,pos);
  assert.equal(duplicate?.source,'candidate');
  assert.equal(duplicate?.id,'fresh-id');
  assert.match(describeRmdAnchorConflict(duplicate!),/当前块内容中重复/);
 });
 it('does not turn pre-existing legacy duplicate IDs into a blocker for unrelated edits',()=>{
  const doc=schema.nodes.doc.create(null,[
   heading('Old heading','legacy-duplicate'),
   schema.nodes.richContainer.create({kind:'note',id:'legacy-duplicate'},[paragraph('Old body')])
  ]);
  const pos=positionOf(doc,node=>node.type.name==='richContainer');
  const candidate=schema.nodes.richContainer.create({kind:'note',id:'legacy-duplicate'},[paragraph('Updated body')]);
  assert.equal(findRmdAnchorConflictForNode(doc,candidate,pos),null);
  assert.ok(findRmdAnchorConflict(doc,'legacy-duplicate'),'legacy conflict remains discoverable for correction');
 });
});
