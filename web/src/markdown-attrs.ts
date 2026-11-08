/** Shared, bounded key=value attribute grammar for Recalloom inline directives.
 * Plain values may contain ASCII letters/digits/underscore/hyphen only;
 * everything else uses a JSON-style double-quoted string.
 * This is independent from remark-directive's permissive HTML attributes.
 */
const keyName=/[a-z][a-z0-9-]*/iy;
export function parseDirectiveAttributes(body:string):Record<string,string>|null{
 const values:Record<string,string>={};
 let i=0;
 while(i<body.length){
  while(i<body.length&&/\s/.test(body[i]!))i++;
  if(i===body.length)break;
  keyName.lastIndex=i;
  const key=keyName.exec(body);
  if(!key||key.index!==i)return null;
  i=keyName.lastIndex;
  if(body[i]!=='=')return null;
  i++;
  let value='';
  if(body[i]==='"'){
   const start=i++;
   let escaped=false,closed=false;
   for(;i<body.length;i++){
    const ch=body[i]!;
    if(!escaped&&ch==='"'){i++;closed=true;break;}
    if(!escaped&&ch==='\\'){escaped=true;continue;}
    escaped=false;
   }
   if(!closed)return null;
   try{value=JSON.parse(body.slice(start,i));}catch{return null;}
  }else{
   const m=/^[A-Za-z0-9_-]+/.exec(body.slice(i));
   if(!m)return null;
   value=m[0];i+=m[0].length;
  }
  if(value.length>300||Object.hasOwn(values,key[0]))return null;
  values[key[0]]=value;
  if(i<body.length&&!/\s/.test(body[i]!))return null;
 }
 return values;
}
export function directiveAttributeString(value:string):string{
 return JSON.stringify(value);
}
export function parseInlineDirectiveSource(source:string,name:string):{raw:string;label:string;attrs:Record<string,string>}|null{
 const prefix=':'+name+'[';
 if(!source.startsWith(prefix))return null;
 let i=prefix.length,escaped=false,label='';
 for(;i<source.length;i++){
  const c=source[i]!;
  if(c==='\n'||c==='\r')return null;
  if(!escaped&&c===']')break;
  if(!escaped&&c==='\\'){escaped=true;continue;}
  label+=c;escaped=false;
 }
 if(source[i]!==']'||!label||label.length>240)return null;
 i++;
 let attrs:Record<string,string>={};
 if(source[i]==='{'){
  const start=i++;
  let quoted=false,slash=false;
  for(;i<source.length;i++){
   const ch=source[i]!;
   if(ch==='\r'||ch==='\n')return null;
   if(quoted){if(!slash&&ch==='"')quoted=false;else if(!slash&&ch==='\\'){slash=true;continue;}slash=false;continue;}
   if(ch==='"'){quoted=true;continue;}
   if(ch==='}')break;
  }
  if(source[i]!=='}')return null;
  const parsed=parseDirectiveAttributes(source.slice(start+1,i));
  if(!parsed)return null;
  attrs=parsed;i++;
 }
 return {raw:source.slice(0,i),label,attrs};
}
