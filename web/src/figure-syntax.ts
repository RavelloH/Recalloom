/**
 * Explicit, bounded attributes for a standalone Markdown image.
 * Example: ![架构图](https://example.com/a.png){width=480 caption="部署架构"}
 * Unlike document front matter these are PRESENTATION attributes, not metadata.
 */
export type FigureAttrs={width:number|null;height:number|null;caption:string};
export function parseFigureSuffix(raw:string):FigureAttrs|null{
 if(!raw.startsWith('{')||!raw.endsWith('}')||raw.length>700||/[\r\n]/.test(raw))return null;
 const body=raw.slice(1,-1);
 const result:FigureAttrs={width:null,height:null,caption:''};
 const seen=new Set<string>();
 const re=/\s*(width|height|caption)=(?:"((?:\\.|[^"\\\r\n])*)"|(\d{1,4}))/gy;
 let index=0;
 while(index<body.length){
  re.lastIndex=index;
  const match=re.exec(body);
  if(!match||match.index!==index||seen.has(match[1]!))return null;
  const key=match[1] as keyof FigureAttrs;
  const quoted=match[2];
  if(key==='caption'){
   if(quoted===undefined)return null;
   try{result.caption=JSON.parse('"'+quoted+'"');}catch{return null;}
   if(result.caption.length>240||/[\r\n]/.test(result.caption))return null;
  }else{
   if(match[3]===undefined)return null;
   const size=Number(match[3]);
   if(!Number.isInteger(size)||size<40||size>1800)return null;
   result[key]=size;
  }
  seen.add(key);
  index=re.lastIndex;
 }
 return seen.size?result:null;
}
export function serializeFigureSuffix(attrs:FigureAttrs):string{
 const parts:string[]=[];
 if(attrs.width!==null)parts.push('width='+attrs.width);
 if(attrs.height!==null)parts.push('height='+attrs.height);
 if(attrs.caption)parts.push('caption='+JSON.stringify(attrs.caption));
 return parts.length?'{'+parts.join(' ')+'}':'';
}
/** Do not expose arbitrary script/data URLs as image resources. */
export function safeFigureImageSrc(src:string):boolean{
 const value=src.trim();
 return value.length>0&&value.length<=2048&&
  !/[\u0000-\u001f<>]/.test(value)&&
  (/^https?:\/\//i.test(value)||/^(?!\/\/)(?![a-z][a-z0-9+.-]*:)[^\s<>"']+$/i.test(value));
}
