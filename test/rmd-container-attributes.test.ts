import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import registry from '../src/rmd/registry.json';
import {richContainerFields,normalizeRichContainerField,CHAT_SENDERS} from '../web/src/tiptap/rmd-container-attributes';

describe('RMD schema-driven rich container fields',()=>{
 it('exposes only supported Schema fields, including round-trip stable IDs',()=>{
  for(const kind of ['highlight','circle','box','bracket','underline','double-underline']){
   const def=registry.components.find(x=>x.type==='block'&&x.name===kind)!;
   const fields=richContainerFields(kind);
   assert.deepEqual(fields,['color','stroke','padding','roughness',...(kind==='highlight'?['opacity']:[]),'id'],kind);
   assert.equal(def.main,'forbidden');
   assert.equal(fields.includes('title'),false,'sketch blocks must not offer a forbidden title');
   assert.ok(fields.includes('id'),'all sketch blocks support stable IDs');
  }
  assert.deepEqual(richContainerFields('message'),['title','sender']);
  assert.deepEqual(richContainerFields('warning'),['title','id']);
  assert.deepEqual(richContainerFields('mark'),['id']);
  assert.deepEqual(richContainerFields('missing'),[]);
 });
 it('accepts nine explicit sketch colors and a true default with no serialized argument',()=>{
  for(const color of registry.colors){
   assert.deepEqual(normalizeRichContainerField('highlight','color',color),{ok:true,value:color});
  }
  assert.deepEqual(normalizeRichContainerField('circle','color',''),{ok:true,value:null});
  assert.equal(normalizeRichContainerField('box','color','magenta').ok,false);
  assert.equal(normalizeRichContainerField('note','color','red').ok,false);
 });
 it('validates exact numerical domain ranges and permits clearing optional fields',()=>{
  for(const [field,lo,hi] of [
   ['stroke','0.5','6'],['padding','0','24'],['roughness','0','3'],['opacity','0.1','0.85']
  ] as const){
   assert.deepEqual(normalizeRichContainerField('highlight',field,lo),{ok:true,value:Number(lo)});
   assert.deepEqual(normalizeRichContainerField('highlight',field,hi),{ok:true,value:Number(hi)});
   assert.deepEqual(normalizeRichContainerField('highlight',field,''),{ok:true,value:null});
  }
  for(const [field,value] of [['stroke','0.49'],['stroke','6.1'],['padding','24.01'],['roughness','-1'],['opacity','0.86'],['opacity','0.001'],['stroke','abc']] as const)
   assert.equal(normalizeRichContainerField('highlight',field,value).ok,false,field+':'+value);
  assert.equal(normalizeRichContainerField('circle','opacity','0.6').ok,false,'only Highlight has opacity');
 });
 it('validates stable container IDs only for permitted RMD block kinds',()=>{
  assert.deepEqual(normalizeRichContainerField('highlight','id','  My-Block '),{ok:true,value:'my-block'});
  assert.deepEqual(normalizeRichContainerField('chat','id',''),{ok:true,value:null});
  assert.equal(normalizeRichContainerField('warning','id','3invalid').ok,false);
  assert.equal(normalizeRichContainerField('note','id','a'.repeat(81)).ok,false);
  assert.equal(normalizeRichContainerField('message','id','message-id').ok,false);
  assert.equal(normalizeRichContainerField('tab','id','tab-id').ok,false);
 });
 it('requires a known Chat sender without broadening the wire schema',()=>{
  assert.deepEqual([...CHAT_SENDERS],['assistant','user','system']);
  for(const sender of CHAT_SENDERS)
   assert.deepEqual(normalizeRichContainerField('message','sender',sender),{ok:true,value:sender});
  for(const sender of ['bot','administrator','','assistant\n'])
   assert.equal(normalizeRichContainerField('message','sender',sender).ok,sender==='assistant\n','invalid '+sender);
  assert.equal(normalizeRichContainerField('tabs','sender','assistant').ok,false);
 });
 it('follows title rules and prevents sketch blocks from acquiring meaningless titles',()=>{
  assert.deepEqual(normalizeRichContainerField('warning','title','注意'),{ok:true,value:'注意'});
  assert.deepEqual(normalizeRichContainerField('message','title','Agent A'),{ok:true,value:'Agent A'});
  assert.equal(normalizeRichContainerField('note','title','x'.repeat(181)).ok,false);
  assert.equal(normalizeRichContainerField('highlight','title','forbidden').ok,false);
 });
});