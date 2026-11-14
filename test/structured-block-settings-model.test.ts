import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {Schema,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {EditorState} from '@tiptap/pm/state';
import {history,undo,redo} from '@tiptap/pm/history';
import {createStructuredBlockTransaction,createStructuredChildBodyTransaction,structuredBlockCandidate,structuredChildBody} from '../web/src/tiptap/structured-block-settings-model';

const schema=new Schema({nodes:{
 doc:{content:'block+'},text:{group:'inline'},
 paragraph:{group:'block',content:'inline*',attrs:{blockId:{default:null}}},
 richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},title:{default:''},sender:{default:null},id:{default:null},color:{default:null},custom:{default:null}}},
 codeBlock:{group:'block',content:'text*',marks:'',attrs:{language:{default:null}}}
},marks:{bold:{}}});
const paragraph=(text:string,id:string|null=null,bold=false)=>schema.nodes.paragraph!.create({blockId:id},text?schema.text(text,bold?[schema.marks.bold!.create()]:undefined):null);
const container=(kind:string,title:string,children:ProseMirrorNode[],attrs:Record<string,unknown>={})=>schema.nodes.richContainer!.create({kind,title,...attrs},children);
const message=(title:string,text:string,attrs:Record<string,unknown>={})=>container('message',title,[paragraph(text,null,true)],{sender:'assistant',...attrs});
const makeState=(root:ProseMirrorNode,siblings:ProseMirrorNode[]=[])=>EditorState.create({schema,plugins:[history()],doc:schema.nodes.doc!.create(null,[root,...siblings])});
const chat=()=>container('chat','会话',[message('Alice','第一条',{custom:'first-private'}),message('Bob','第二条',{custom:'second-private'})],{id:'chat-one',color:'blue',custom:'parent-private'});

describe('structured block settings transactions',()=>{
 it('edits one child name while preserving parent and all sibling data',()=>{
  const state=makeState(chat()),original=state.doc.firstChild!;
  const candidate=structuredBlockCandidate(state,0,{type:'field',index:0,field:'title',value:'新名字'});
  assert.deepEqual(candidate.attrs,original.attrs);
  assert.equal(candidate.child(1),original.child(1));
  assert.equal(candidate.child(0).content,original.child(0).content);
  assert.equal(candidate.child(0).attrs.custom,'first-private');
  assert.equal(candidate.child(0).attrs.sender,'assistant');
  assert.equal(candidate.child(1).firstChild!.firstChild!.marks[0]!.type.name,'bold');
 });
 it('parses Markdown content inside its actual envelope and keeps child attributes',()=>{
  const state=makeState(chat()),original=state.doc.firstChild!;
  const body='**更改内容** @ attrs child-anchor @';
  const candidate=structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:body});
  assert.deepEqual(candidate.child(0).attrs,original.child(0).attrs);
  assert.equal(candidate.child(1),original.child(1));
  assert.equal(candidate.child(0).firstChild!.attrs.blockId,'child-anchor');
  assert.equal(candidate.child(0).firstChild!.firstChild!.marks[0]!.type.name,'bold');
  assert.equal(structuredChildBody(candidate.child(0)),body);
 });
 it('accepts nested RMD structures and code containing delimiter text',()=>{
  const state=makeState(chat());
  const body=[':::: tabs','', '::: tab 子标签','', '内容','', ':::','', '::::','', '```txt','::: tab 这里只是代码','```'].join('\n');
  const candidate=structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:body});
  assert.equal(candidate.child(0).child(0).attrs.kind,'tabs');
  assert.equal(candidate.child(0).child(1).type.name,'codeBlock');
 });
 it('rejects invalid structural bodies and unsafe names without changing state',()=>{
  const state=makeState(chat()),before=state.doc;
  for(const body of ['::: tab 孤立\n\n正文\n\n:::','::: tabs 未闭合\n\n内容'])
   assert.throws(()=>structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:body}));
  for(const title of ['', '名字\n第二行','名字 | id=intruder'])
   assert.throws(()=>structuredBlockCandidate(state,0,{type:'field',index:0,field:'title',value:title}));
  assert.equal(state.doc,before);
 });
 it('rejects newly colliding anchors in changed bodies',()=>{
  const state=makeState(chat(),[paragraph('外部','taken')]);
  assert.throws(()=>structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:'正文 @ attrs taken @'}),/锚点/);
  assert.throws(()=>structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:'第一段 @ attrs duplicate @\n\n第二段 @ attrs duplicate @'}),/锚点/);
 });
 it('reorders exact immutable children, adds safe defaults, and protects the final child',()=>{
  const state=makeState(chat()),original=state.doc.firstChild!;
  const moved=structuredBlockCandidate(state,0,{type:'move',index:1,direction:-1});
  assert.equal(moved.child(0),original.child(1));assert.equal(moved.child(1),original.child(0));
  const added=structuredBlockCandidate(state,0,{type:'add'});
  assert.equal(added.childCount,3);assert.equal(added.child(2).attrs.sender,'assistant');
  assert.equal(added.child(2).attrs.id,null);assert.equal(added.child(2).attrs.custom,null);
  const only=makeState(container('chat','',[message('Agent','内容')]));
  assert.throws(()=>structuredBlockCandidate(only,0,{type:'remove',index:0}),/至少一个/);
 });
 it('supports tabs and glossary fields through the same pipeline',()=>{
  for(const [parent,child] of [['tabs','tab'],['glossary','definition']] as const){
   const state=makeState(container(parent,'标题',[container(child,'条目',[paragraph('内容')])]));
   const tr=createStructuredBlockTransaction(state,0,{type:'field',index:0,field:'body',value:'新正文'});
   assert.equal(tr.doc.firstChild!.firstChild!.textContent,'新正文');
   assert.equal(tr.doc.firstChild!.firstChild!.attrs.kind,child);
  }
 });
 it('keeps flashcard front/back complete, ordered, and isolated',()=>{
  const front=container('front','',[paragraph('正面','front-text')]),back=container('back','',[paragraph('背面',null,true)]);
  const state=makeState(container('flashcard','记忆卡',[front,back],{id:'card-one'}));
  for(const action of [{type:'add'},{type:'remove',index:0},{type:'move',index:1,direction:-1}] as const)
   assert.throws(()=>structuredBlockCandidate(state,0,action));
  const changed=structuredBlockCandidate(state,0,{type:'field',index:0,field:'body',value:'新正面 @ attrs front-text @'});
  assert.equal(changed.child(1),back);assert.deepEqual(changed.attrs,state.doc.firstChild!.attrs);
  const tr=createStructuredChildBodyTransaction(state,1,'独立正面 @ attrs front-text @');
  assert.equal(tr.doc.firstChild!.child(1),back);
  assert.equal(tr.doc.firstChild!.child(0).attrs.title,'');
  assert.equal(tr.doc.firstChild!.child(0).firstChild!.attrs.blockId,'front-text');
 });
 it('applies one transaction and supports parent undo and redo',()=>{
  let state=makeState(chat());const original=state.doc;
  const tr=createStructuredBlockTransaction(state,0,{type:'field',index:0,field:'sender',value:'user'});
  assert.equal(tr.steps.length,1);assert.equal(tr.getMeta('rk-block-panel-edit'),true);assert.equal(tr.getMeta('rk-block-panel-field-edit'),true);
  state=state.apply(tr);const edited=state.doc;
  assert.equal(undo(state,next=>{state=state.apply(next);}),true);assert.ok(state.doc.eq(original));
  assert.equal(redo(state,next=>{state=state.apply(next);}),true);assert.ok(state.doc.eq(edited));
  assert.equal(createStructuredBlockTransaction(state,0,{type:'field',index:0,field:'sender',value:'user'}).docChanged,false);
 });
 it('rejects invalid roles and stale child indices',()=>{
  const state=makeState(chat());
  assert.throws(()=>structuredBlockCandidate(state,0,{type:'field',index:0,field:'sender',value:'unknown'}),/身份/);
  assert.throws(()=>structuredBlockCandidate(state,0,{type:'remove',index:20}),/变化/);
 });
});
