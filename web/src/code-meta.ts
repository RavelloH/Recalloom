/** Stable markdown code fence metadata, independent of the renderer. */
export type CodeMeta={language:string|null;filename:string;wrap:boolean;expand:boolean};
export function parseCodeFenceMeta(info:string):CodeMeta{
 const trimmed=info.trim();
 const m=/^([^\s\[]+)?(?:\s*\[([^\]\r\n]{1,240})\])?(.*)$/.exec(trimmed);
 if(!m)return {language:null,filename:'',wrap:false,expand:false};
 const tail=m[3]??'';
 return {language:(m[1]||null),filename:m[2]??'',wrap:/(?:^|\s)wrap(?:\s|$)/.test(tail),expand:/(?:^|\s)expand(?:\s|$)/.test(tail)};
}
