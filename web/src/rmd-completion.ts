import type {Completion,CompletionContext,CompletionResult} from '@codemirror/autocomplete';
import {syntaxTree} from '@codemirror/language';
import {RMD_REGISTRY,getRmdSchema,attrsByBlock,type RmdNodeType} from './rmd-schema';

export type RmdCompletionGroup={from:number;entries:Completion[]};

/** Suggest fields from the actual block schema rather than a global list. */
export function guessRmdAttrsTarget(prefix:string,previousLine:string):string{
 const source=prefix.trim()||previousLine.trim();
 if(/^#{1,6}\s/.test(source))return 'heading';
 if(/^!\[[^\]]*\]\([^)]*\)/.test(source))return 'image';
 if(/^\$\$\s*$/.test(source))return 'math';
 if(/^(\x60{3,}|~{3,})/.test(source))return 'code';
 if(/^\|/.test(source)||/\|\s*$/.test(source))return 'table';
 return 'paragraph';
}
const distinct=(values:Completion[])=>[...new Map(values.map(v=>[v.label,v])).values()];
const suggestions=(fields:Readonly<Record<string,string>>,prefix:string,typed:string)=>{
 const used=new Set([...prefix.matchAll(/\|\s*([a-z][a-z0-9-]*)\s*=/g)].map(x=>x[1]));
 return Object.entries(fields).filter(([key])=>!used.has(key)||key===typed).map(([key,type])=>({
  label:key+'=',type:'property',apply:key+'=',detail:type
 } as Completion));
};
/** Pure candidate provider; can be tested without CodeMirror DOM. */
export function rmdCompletionCandidates(before:string,previousLine=''):RmdCompletionGroup|null{
 const opener=/(^|[\s(])(:{2,64})\s+([a-z][a-z0-9-]*)?$/.exec(before);
 if(opener){
  const typed=opener[3]??'',type=opener[2]!.length===2?'inline':'block';
  const defs=RMD_REGISTRY.components.filter(c=>type==='inline'?c.type==='inline':c.type==='block'||c.type==='leaf');
  return {from:before.length-typed.length,entries:distinct(defs.filter(c=>c.name.startsWith(typed)).map(c=>({
   label:c.name,type:'keyword',apply:c.name+' ',detail:c.summary
  })))};
 }
 const ending=/(?:^|\s)(:{2,64})\s+([a-z][a-z0-9-]*)\s+(.+)$/.exec(before);
 if(ending){
  const kind:RmdNodeType=ending[1]!.length===2?'inline':'block';
  const name=ending[2]!;
  const schema=getRmdSchema(kind,name)??(kind==='block'?getRmdSchema('leaf',name):undefined);
  if(schema){
   const value=/\|\s*([a-z][a-z0-9-]*)=(\w*)$/.exec(ending[3]!);
   if(value&&['color','variant'].includes(value[1]!)){
    const options=value[1]==='color'?RMD_REGISTRY.colors:RMD_REGISTRY.variants;
    return {from:before.length-value[2]!.length,entries:options.filter(x=>x.startsWith(value[2]!)).map(label=>({label,type:'enum'}))};
   }
   const property=/\|\s*([a-z][a-z0-9-]*)?$/.exec(ending[3]!);
   if(property){
    const typed=property[1]??'';
    const usedNamed=/\|\s*[a-z][a-z0-9-]*\s*=/.test(ending[3]!);
    const positionKind=schema.positions.length===1?schema.attributes[schema.positions[0]!] :undefined;
    const enumChoices=!usedNamed&&positionKind==='color'?RMD_REGISTRY.colors:
     !usedNamed&&positionKind==='variant'?RMD_REGISTRY.variants:[];
    const props=suggestions(schema.attributes,ending[3]!,typed).filter(x=>x.label.startsWith(typed));
    const enums=enumChoices.filter(value=>value.startsWith(typed)).map(label=>({label,type:'enum'} as Completion));
    return {from:before.length-typed.length,entries:[...props,...enums]};
   }
  }
 }
 const attr=/@ attrs(?:\s+[a-z][a-z0-9-]*)?\s*\|\s*([a-z][a-z0-9-]*)?$/.exec(before);
 if(attr){
  const typed=attr[1]??'',prefix=before.slice(0,attr.index);
  const target=guessRmdAttrsTarget(prefix,previousLine);
  const defs=attrsByBlock[target];
  if(!defs)return null;
  return {from:before.length-typed.length,
   entries:suggestions(defs,before,typed).filter(x=>x.label.startsWith(typed))};
 }
 return null;
}
export function rmdCompletionSource(context:CompletionContext):CompletionResult|null{
 let node:ReturnType<typeof syntaxTree>['topNode']|null=syntaxTree(context.state).resolveInner(context.pos,-1);
 for(;node;node=node.parent)
  if(/FencedCode|CodeText|InlineCode|LinkDestination|URL|HTMLTag/.test(node.name))return null;
 const line=context.state.doc.lineAt(context.pos);
 const before=line.text.slice(0,context.pos-line.from);
 const previousLine=line.number>1?context.state.doc.line(line.number-1).text:'';
 const group=rmdCompletionCandidates(before,previousLine);
 if(!group||group.entries.length===0)return null;
 return {from:line.from+group.from,options:group.entries,validFor:/^[a-z0-9-]*$/};
}
