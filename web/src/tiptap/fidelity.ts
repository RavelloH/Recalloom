/**
 * Explicitly approved syntax-only changes from NeutralPress's Markdown writers.
 * Unknown HTML/MDX/frontmatter continues to fall back to source editing.
 */
export function canonicalMarkdown(input:string):string{
 const lines=input.replace(/\r\n/g,'\n').trimEnd().split('\n');
 let fenceChar:string|undefined;
 return lines.map((line,i)=>{
  const fence=/^\s{0,3}(\x60{3,}|~{3,})/.exec(line);
  if(fence){const mark=fence[1]![0];if(!fenceChar)fenceChar=mark;else if(fenceChar===mark)fenceChar=undefined;return line;}
  if(fenceChar)return line;
  let out=line;
  // NeutralPress reads ++underline++ and serializes it as equivalent <u>.
  // Ignore fenced content and inline code spans.
  out=out.split(/(\x60+[^\x60]*\x60+)/g).map((part,k)=>k%2?part:part.replace(/\+\+([^\n+][^\n]*?)\+\+/g,(_,v:string)=>'<u>'+v.trim()+'</u>')).join('');
  // Preserve table alignment semantics; delimiter dash count is insignificant.
  if(i>0 && lines[i-1]?.includes('|') && out.includes('|')){
   const cells=out.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim());
   if(cells.length>1&&cells.every(c=>/^:?-{3,}:?$/.test(c))){
    const sep=cells.map(c=>c.startsWith(':')&&c.endsWith(':')?':------:':c.endsWith(':')?'-------:':'--------');
    out='| '+sep.join(' | ')+' |';
   }
  }
  return out;
 }).join('\n').trimEnd();
}
export function markdownRoundTripSafe(original:string,rendered:string):boolean{
 return canonicalMarkdown(original)===canonicalMarkdown(rendered);
}
