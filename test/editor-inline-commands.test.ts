import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {RMD_REGISTRY} from '../web/src/rmd-schema';
import {SKETCH_KINDS} from '../web/src/sketch-geometry';
import {
 inlineRmdCommands,inlineCommandsByGroup,
 canUseInlineRmdCommand,runInlineRmdCommand
} from '../web/src/tiptap/editor-inline-commands';
import {slashCommands} from '../web/src/tiptap/slash-commands';

type Call={name:string;args:unknown[]};
function mockEditor(opts:{code?:boolean;multi?:boolean;selection?:string;inlineAtom?:boolean}={}){
 const calls:Call[]=[];
 const chain:any={
  focus(){calls.push({name:'focus',args:[]});return chain;},
  toggleMark(...args:unknown[]){calls.push({name:'toggleMark',args});return chain;},
  insertContent(...args:unknown[]){calls.push({name:'insertContent',args});return chain;},
  run(){calls.push({name:'run',args:[]});return true;}
 };
 const editor={
  isActive:(type:string)=>type==='codeBlock'&&!!opts.code,
  state:{selection:{
   empty:!opts.selection,from:1,to:opts.selection?.length??1,
   $from:{sameParent:()=>!opts.multi},$to:{}
  },doc:{textBetween:()=>opts.selection??'',nodesBetween:(_from:number,_to:number,cb:(node:unknown)=>void)=>{if(opts.inlineAtom)cb({isInline:true,isText:false});}}},
  chain:()=>chain
 } as unknown as Editor;
 return {editor,calls};
}
describe('shared RMD inline command registry',()=>{
 it('maps exactly all fifteen inline RMD grammar entries',()=>{
  const expected=RMD_REGISTRY.components.filter(x=>x.type==='inline').map(x=>x.name).sort();
  assert.equal(expected.length,15);
  assert.deepEqual(inlineRmdCommands.map(x=>x.syntax).sort(),expected);
  assert.equal(new Set(inlineRmdCommands.map(x=>x.id)).size,15);
  assert.equal(inlineCommandsByGroup('hand-drawn').length,9);
  assert.deepEqual(inlineCommandsByGroup('hand-drawn').map(x=>x.syntax),[...SKETCH_KINDS]);
  assert.deepEqual(inlineCommandsByGroup('inline-component').map(x=>x.syntax),['badge','tooltip','abbr','kbd','cloze']);
 });
 it('keeps semantic mark distinct from every hand-drawn mark and ordinary underline',()=>{
  const a=mockEditor();
  assert.equal(runInlineRmdCommand(a.editor,'mark'),true);
  assert.deepEqual(a.calls.find(x=>x.name==='toggleMark')?.args,['rmdMark']);
  for(const kind of SKETCH_KINDS){
   const b=mockEditor({selection:'公式'});
   assert.equal(runInlineRmdCommand(b.editor,kind),true,kind);
   assert.deepEqual(b.calls.find(x=>x.name==='toggleMark')?.args,['rmdSketch',{kind}]);
  }
 });
 it('builds editable inline RMD nodes without dropping selected plain text',()=>{
  const nodeType:{[key:string]:string}={badge:'richBadge',tooltip:'richTooltip',abbr:'richAbbr',kbd:'richKbd',cloze:'richCloze'};
  for(const [syntax,type] of Object.entries(nodeType)){
   const m=mockEditor({selection:'所选文字'});
   assert.equal(runInlineRmdCommand(m.editor,syntax),true);
   const obj=m.calls.find(x=>x.name==='insertContent')?.args[0] as any;
   assert.equal(obj?.type,type);
   assert.deepEqual(obj?.content,[{type:'text',text:'所选文字'}]);
  }
 });
 it('blocks rich inline nodes across multiple text blocks or in code blocks',()=>{
  const multi=mockEditor({selection:'两段',multi:true});
  assert.equal(canUseInlineRmdCommand(multi.editor,'badge'),false);
  assert.equal(runInlineRmdCommand(multi.editor,'badge'),false);
  assert.equal(multi.calls.length,0);
  const atom=mockEditor({selection:'$E$',inlineAtom:true});
  assert.equal(runInlineRmdCommand(atom.editor,'badge'),false,'do not discard inline KaTeX or Wiki nodes');
  assert.equal(atom.calls.length,0);
  const code=mockEditor({code:true});
  assert.equal(runInlineRmdCommand(code.editor,'highlight'),false);
  assert.equal(code.calls.length,0);
 });
 it('keeps fluorescent highlight in the inline toolbar, not in slash insertion',()=>{
  const command=inlineCommandsByGroup('hand-drawn').find(c=>c.syntax==='highlight');
  assert.ok(!slashCommands.some(c=>c.id==='color-highlight'),'inline formatting is not a slash insertion');
  assert.ok(command);
  const m=mockEditor({selection:'内容'});
  command.run(m.editor);
  assert.deepEqual(m.calls.find(x=>x.name==='toggleMark')?.args,['rmdSketch',{kind:'highlight'}]);
 });
});
