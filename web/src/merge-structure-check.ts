import {getRmdSchema} from './rmd-schema';

export type MergeDiagnostic={
 severity:'error'|'warning';line:number;code:string;message:string
};
/** Bounded, conservative Markdown/RMD structural preflight.
 * This is not a full semantic verifier; unsupported syntax is left intact.
 * Never normalizes or changes the candidate text.
 */
export function checkMergeStructure(source:string):MergeDiagnostic[]{
 const issues:MergeDiagnostic[]=[];
 if(source.length>300_000)return[{severity:'warning',line:1,code:'size',message:'内容较长，未执行结构预检；请在编辑器中完整检查。'}];
 const lines=source.split(/\r?\n/);
 type Open={kind:'code'|'directive'|'math';line:number;marker?:string;length?:number;name?:string};
 const stack:Open[]=[];
 const add=(severity:MergeDiagnostic['severity'],line:number,code:string,message:string)=>
  issues.push({severity,line,code,message});
 const codeFence=new RegExp('^ {0,3}(['+String.fromCharCode(96)+'~]{3,})(.*)$');
 for(let index=0;index<lines.length;index++){
  const raw=lines[index]!,line=index+1;
  const trimmed=raw.trim();
  const top=stack.at(-1);
  if(top?.kind==='code'){
   const close=new RegExp('^'+top.marker+'{'+top.length+',}[ \\t]*$');
   if(close.test(trimmed))stack.pop();
   continue;
  }
  if(top?.kind==='math'){
   if(/^\$\$[ \t]*$/.test(trimmed))stack.pop();
   continue;
  }
  const code=codeFence.exec(raw);
  if(code&&[...code[1]!].every(ch=>ch===code[1]![0])){
   stack.push({kind:'code',line,marker:code[1]![0],length:code[1]!.length});
   continue;
  }
  if(/^\$\$[ \t]*$/.test(trimmed)){
   stack.push({kind:'math',line});continue;
  }
  const closing=/^ {0,3}(:{3,})[ \t]*$/.exec(raw);
  if(closing){
   const open=stack.at(-1);
   if(open?.kind==='directive'&&closing[1]!.length===open.length)stack.pop();
   else add('error',line,'rmd-close','RMD 容器的关闭围栏没有对应的同长度开启围栏。');
   continue;
  }
  const opening=/^ {0,3}(:{3,})[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+(.*))?$/.exec(raw);
  if(opening){
   const marker=opening[1]!,name=opening[2]!,attrs=opening[3]??'';
   if(new RegExp('[ \\t]+'+':'.repeat(marker.length)+'[ \\t]*$').test(attrs))continue;
   if(!getRmdSchema('block',name)){
    add('warning',line,'rmd-unknown','疑似未知 RMD 容器：'+name+'；保留原文，请手动检查。');
    continue;
   }
   const parent=stack.at(-1);
   if(parent?.kind==='directive'&&marker.length>=parent.length!)
    add('error',line,'rmd-nesting','嵌套容器围栏须短于父容器，避免渲染歧义。');
   stack.push({kind:'directive',line,length:marker.length,name});
  }
 }
 for(const open of stack){
  if(open.kind==='directive')add('error',open.line,'rmd-open','RMD 容器 '+open.name+' 缺少关闭围栏。');
  if(open.kind==='code')add('error',open.line,'code-fence','Markdown 代码围栏缺少对应的结束围栏。');
  if(open.kind==='math')add('error',open.line,'math-fence','块级数学公式 $$ 缺少结束标记。');
 }
 return issues;
}
