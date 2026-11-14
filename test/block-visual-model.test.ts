import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {Schema,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {assertRmdBlockCandidate,assertRmdStructure,assertVisualField} from '../web/src/tiptap/block-visual-model';

const schema=new Schema({nodes:{doc:{content:'block+'},text:{group:'inline'},paragraph:{group:'block',content:'text*',attrs:{blockId:{default:null}}},richContainer:{group:'block',content:'block+',attrs:{kind:{default:'note'},title:{default:''},sender:{default:null},id:{default:null}}}}});
const paragraph=(text='')=>schema.nodes.paragraph!.create(null,text?schema.text(text):null);
const container=(kind:string,children:ProseMirrorNode[]= [paragraph('正文')],title='',id:string|null=null)=>schema.nodes.richContainer!.create({kind,title,id},children);
const check=(node:ProseMirrorNode)=>assertRmdBlockCandidate(schema.nodes.doc!.create(null,node),node,0);
describe('visual panel RMD semantic transactions',()=>{
 it('rejects ordinary prose replacing structural children even though PM accepts it',()=>{
  for(const kind of ['tabs','chat','glossary','flashcard']){
   const node=container(kind);node.check();assert.throws(()=>check(node),/结构子块/);
  }
 });
 it('rejects detached children and wrong immediate parents',()=>{
  for(const kind of ['tab','message','definition','front','back'])assert.throws(()=>check(container(kind)),/父容器/);
  assert.throws(()=>check(container('tabs',[container('definition')])),/结构子块/);
  assert.throws(()=>check(container('note',[container('tab')])),/父容器/);
 });
 it('enforces exactly one front/back pair in that order',()=>{
  const front=container('front'),back=container('back');
  assert.doesNotThrow(()=>check(container('flashcard',[front,back])));
  for(const children of [[front],[back,front],[front,back,back]])assert.throws(()=>check(container('flashcard',children)),/闪卡/);
 });
 it('accepts repeatable children, empty bodies and stable identities',()=>{
  for(const [parent,child] of [['tabs','tab'],['glossary','definition']] as const){
   const node=container(parent,[container(child,[paragraph()], '标题'),container(child,[paragraph('内容')],'另一个')],'父标题','parent-id');
   assert.doesNotThrow(()=>check(node));
  }
  const message=schema.nodes.richContainer!.create({kind:'message',title:'Agent',sender:'assistant'},paragraph());
  assert.doesNotThrow(()=>check(container('chat',[message])));
 });
 it('validates an individually edited nested flashcard side within its pair',()=>{
  const parent=container('flashcard',[container('front'),container('back')]);
  const document=schema.nodes.doc!.create(null,parent);
  assert.doesNotThrow(()=>assertRmdBlockCandidate(document,container('front',[paragraph('新内容')]),1));
 });
 it('rejects titles that canonical parsing reinterprets as RMD metadata',()=>{
  assert.throws(()=>check(container('tabs',[container('tab',[paragraph('内容')],'标题 | id=intruder')])),/RMD/);
  assert.throws(()=>check(container('note',[paragraph('内容')],'第一行\n第二行')),/RMD/);
 });
 it('retains deep structural parent constraints through ordinary prose nodes',()=>{
  assert.throws(()=>assertRmdStructure({type:'richContainer',attrs:{kind:'tabs'},content:[{type:'paragraph',content:[{type:'richContainer',attrs:{kind:'tab'}}]}]}),/结构子块/);
 });
});
describe('visual native field validation',()=>{
 it('accepts web and relative image URLs and rejects unsafe or incomplete addresses',()=>{
  for(const value of ['https://example.com/image.png','/image.png','../assets/pic.webp'])assert.doesNotThrow(()=>assertVisualField('image','src',value));
  for(const value of ['', 'javascript:alert(1)','data:text/html,test','https://example.com/a b','https://'])assert.throws(()=>assertVisualField('image','src',value));
 });
 it('prevents language fence injection while accepting familiar language labels',()=>{
  for(const value of ['','tsx','c++','c#','objective-c'])assert.doesNotThrow(()=>assertVisualField('codeBlock','language',value));
  for(const value of ['js\n```','js bad','~~~'])assert.throws(()=>assertVisualField('codeBlock','language',value));
 });
 it('accepts multiline LaTeX and retains invalid delimiter drafts outside the document',()=>{
  assert.doesNotThrow(()=>assertVisualField('blockMath','latex','\\begin{aligned}\nx&=1\\\\\ny&=2\n\\end{aligned}'));
  assert.doesNotThrow(()=>assertVisualField('inlineMath','latex','\\$5'));
  for(const value of ['', 'x\n$$\ny'])assert.throws(()=>assertVisualField('blockMath','latex',value));
  for(const value of ['$x$', 'x\ny'])assert.throws(()=>assertVisualField('inlineMath','latex',value));
 });
});
