import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {RMD_REGISTRY} from '../web/src/rmd-schema';
import {extraBlockCommands,insertionForRmdChild,insertRmdBlock,insertRmdChild} from '../web/src/tiptap/editor-block-commands';
import {slashCommands,filterSlashCommands,groupSlashCommands} from '../web/src/tiptap/slash-commands';

function mock(opts:{parents?:{kind:string;childKinds?:string[]}[];nonempty?:boolean;code?:boolean;table?:boolean}={}){
 const calls:{name:string;args:any[]}[]=[];
 const mkNode=(kind:string,children:string[]=[])=>({
  type:{name:'richContainer'},attrs:{kind},childCount:children.length,
  child:(i:number)=>({attrs:{kind:children[i]},nodeSize:4})
 });
 const parents=(opts.parents??[]).map(x=>mkNode(x.kind,x.childKinds));
 const fake:any={isActive:(name:string)=>name==='codeBlock'?!!opts.code:name==='table'?!!opts.table:false};
 fake.state={selection:{
  empty:!opts.nonempty,
  $from:{depth:parents.length,
   node:(d:number)=>d===0?{type:{name:'doc'}}:parents[d-1],
   start:(d:number)=>10*d,end:(d:number)=>20*d}
 }};
 const chain:any={focus(){calls.push({name:'focus',args:[]});return chain},
  insertContentAt(...args:any[]){calls.push({name:'insertContentAt',args});return chain;},
  insertContent(...args:any[]){calls.push({name:'insertContent',args});return chain;},
  run(){calls.push({name:'run',args:[]});return true;}};
 fake.chain=()=>chain;
 return {editor:fake as Editor,calls};
}
describe('RMD block entry registry',()=>{
 it('offers each of 25 registered block syntaxes in the slash family, plus both leaf entries',()=>{
  const names=RMD_REGISTRY.components.filter(x=>x.type==='block').map(x=>x.name);
  for(const name of names){
   assert.ok(slashCommands.some(x=>x.id==='rmd-block:'+name)||[
    ['details','details'],['tabs','tabs'],['chat','chat'],['flashcard','flashcard'],['glossary','glossary']
   ].some(([key,id])=>key===name&&slashCommands.some(x=>x.id===id)),name+' missing');
  }
  assert.ok(slashCommands.some(x=>x.id==='wiki-embed'));
  assert.ok(slashCommands.some(x=>x.id==='link-card'));
  assert.equal(new Set(extraBlockCommands.map(x=>x.syntax)).size,extraBlockCommands.length);
 });
 it('groups slash commands into discoverable syntax families without changing flat keyboard order',()=>{
  const groups=groupSlashCommands(slashCommands);
  assert.deepEqual(groups.map(group=>group.id),['basic','layout','callout','sketch','study','reference','media','format','inline']);
  assert.ok(groups.find(group=>group.id==='callout')?.commands.some(command=>command.id==='rmd-block:warning'));
  assert.ok(groups.find(group=>group.id==='sketch')?.commands.some(command=>command.id==='rmd-block:highlight'));
  assert.ok(groups.find(group=>group.id==='study')?.commands.some(command=>command.id==='flashcard'));
  const filtered=groupSlashCommands(filterSlashCommands(mock().editor,'危险'));
  assert.deepEqual(filtered.map(group=>group.id),['callout']);
  assert.equal(groups.flatMap(group=>group.commands).length,slashCommands.length);
 });
 it('creates the correct RMD mark, sketch or callout block with valid paragraphs',()=>{
  for(const syntax of ['note','info','tip','success','warning','danger','example','question','mark','highlight','circle','box','bracket','underline','double-underline']){
   const m=mock();
   assert.equal(insertRmdBlock(m.editor,syntax),true);
   const data=m.calls.find(x=>x.name==='insertContent')?.args[0];
   assert.equal(data.type,'richContainer',syntax);
   assert.equal(data.attrs.kind,syntax);
   assert.equal(data.content[0].type,'paragraph');
  }
 });
 it('hides child insertion in an invalid context, including code and tables',()=>{
  const root=mock();
  for(const child of ['tab','message','front','back','definition'])
   assert.equal(insertionForRmdChild(root.editor,child),null);
  for(const kind of ['note','box','highlight']){
   assert.equal(insertRmdBlock(mock({code:true}).editor,kind),false);
   assert.equal(insertRmdBlock(mock({table:true}).editor,kind),false);
  }
  assert.ok(!filterSlashCommands(root.editor,'添加标签页').some(x=>x.id==='rmd-block:tab'));
 });
 it('adds children at the end of the correct legal ancestor instead of inside nested text',()=>{
  for(const [kind,parent] of [['tab','tabs'],['message','chat'],['definition','glossary']] as const){
   const m=mock({parents:[{kind:parent,childKinds:[kind]} ,{kind}]});
   assert.deepEqual(insertionForRmdChild(m.editor,kind),{pos:20,parent});
   assert.equal(insertRmdChild(m.editor,kind),true);
   const value=m.calls.find(x=>x.name==='insertContentAt')?.args;
   assert.equal(value?.[0],20);
   assert.equal(value?.[1]?.attrs?.kind,kind);
  }
 });
 it('prevents duplicate flashcard front/back and preserves ordered insertion',()=>{
  const card=mock({parents:[{kind:'flashcard',childKinds:['back']},{kind:'back'}]});
  assert.deepEqual(insertionForRmdChild(card.editor,'front'),{pos:10,parent:'flashcard'});
  assert.equal(insertionForRmdChild(card.editor,'back'),null);
  const full=mock({parents:[{kind:'flashcard',childKinds:['front','back']},{kind:'back'}]});
  assert.equal(insertionForRmdChild(full.editor,'front'),null);
  assert.equal(insertionForRmdChild(full.editor,'back'),null);
  assert.equal(insertRmdChild(full.editor,'front'),false);
 });
});
