import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

const docs=['README.md','web/src/ICON_SYSTEM.md','web/src/styles/README.md'];
function scan(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const name=join(dir,entry.name);
  if(entry.isDirectory()){scan(name);continue}
  if(name.endsWith('.md'))docs.push(name);
 }
}
scan('docs');
const missing=[];
for(const doc of docs){
 const content=readFileSync(doc,'utf8');
 // Strip fenced code blocks so illustrative Markdown links are not audited.
 const visible=content.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm,'');
 const links=[...visible.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)];
 for(const match of links){
  let value=match[1].trim().replace(/^<|>$/g,'').split(/\s+\"/)[0];
  if(!value||/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))continue;
  value=value.split('#')[0].split('?')[0];
  if(!value)continue;
  try{value=decodeURIComponent(value)}catch{/* retain raw link */}
  const target=value.startsWith('/')?resolve('web/public',value.slice(1)):resolve(dirname(doc),value);
  if(!existsSync(target))missing.push(doc+' → '+value);
 }
}
if(missing.length){console.error('Broken local Markdown links:\n'+missing.join('\n'));process.exitCode=1}
else console.log('Documentation links verified: '+docs.length+' Markdown files, no missing local targets');