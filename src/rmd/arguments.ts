/** Split at whitespace-delimited pipes outside quoted or escaped strings. */
export function splitRmdArguments(input:string):string[]|null{
 const result:string[]=[];let start=0,quoted=false,backslash=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(backslash){backslash=false;continue;}
  if(ch==='\\'){backslash=true;continue;}
  if(ch==='"'){quoted=!quoted;continue;}
  if(ch==='|'&&!quoted&&i>0&&i<input.length-1&&/\s/.test(input[i-1]!)&&/\s/.test(input[i+1]!)){
   result.push(input.slice(start,i).trim());
   start=i+1;
  }
 }
 if(quoted||backslash)return null;
 result.push(input.slice(start).trim());
 return result;
}
