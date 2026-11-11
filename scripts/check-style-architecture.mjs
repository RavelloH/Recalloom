// Enforce a single owner for every global selector. This is intentionally
// separate from icon auditing: style overrides must not become silent patches.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const postcss=createRequire(require.resolve('vite'))('postcss');
const directory='web/src/styles';
const index=join(directory,'index.css');
const imported=readFileSync(index,'utf8');
const imports=[...imported.matchAll(/@import\s+["']([^"']+\.css)["']\s*;/g)].map(m=>m[1]);
const errors=[];
const all=[];
function walk(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const file=join(dir,entry.name);
  if(entry.isDirectory())walk(file);
  else if(file.endsWith('.css')&&file!==index)all.push(file);
 }
}
walk(directory);
const importedFiles=imports.map(name=>resolve(dirname(index),name));
const importedSet=new Set(importedFiles);
// These feature styles are shipped with their route/component chunk instead of
// the global CSS, but still participate in the same single-owner audit.
const routeStyles=new Map([
 ['features/graph.css',['web/src/knowledge-graph.tsx']],
 ['features/relations.css',['web/src/knowledge-graph.tsx','web/src/record-relations.tsx']],
 ['features/rmd.css',['web/src/record-editor.tsx','web/src/markdown-preview.tsx']],
 ['features/editor-chrome.css',['web/src/record-editor.tsx']],
 ['features/records.css',['web/src/pages/record.tsx']]
]);
if(importedSet.size!==imports.length)errors.push('styles/index.css imports a stylesheet more than once');
for(const file of all){
 const target=resolve(file),relativeName=relative(directory,file).replaceAll('\\','/');
 if(!importedSet.has(target)&&!routeStyles.has(relativeName))errors.push('unregistered stylesheet: '+file);
 if(importedSet.has(target)&&routeStyles.has(relativeName))errors.push('route CSS must not also be globally imported: '+relativeName);
}
for(const file of importedFiles)if(!existsSync(file))errors.push('missing import: '+relative(directory,file));
for(const [css,owners] of routeStyles){
 const file=join(directory,css);
 if(!existsSync(file))errors.push('missing on-demand CSS: '+css);
 for(const consumer of owners){
  const spec=relative(dirname(consumer),file).replaceAll('\\','/');
  const importPath=spec.startsWith('.')?spec:'./'+spec;
  if(!existsSync(consumer)||!readFileSync(consumer,'utf8').includes("import '"+importPath+"';"))
   errors.push('route CSS '+css+' must be imported by '+consumer);
 }
}
const main=readFileSync('web/src/main.tsx','utf8');
if(!main.includes("import './styles/index.css';"))errors.push('main.tsx must import styles/index.css');
const legacy=['style','design-system','motion','ui-enhancements','content-layout','document-typography','graph','wiki','workspace','polish','icon-layout'];
for(const file of legacy)if(existsSync('web/src/'+file+'.css'))errors.push('legacy patch CSS must be removed: '+file+'.css');
let important=0,rules=0,media=0;
const owner=new Map();
const required=[
 '--rk-icon-sm','--rk-font-caption','--rk-font-small','--rk-font-label',
 '--rk-font-body','--rk-font-control','--rk-mark-background'
];
for(const file of all){
 const source=readFileSync(file,'utf8');
 let root;
 try{root=postcss.parse(source,{from:file})}catch(error){errors.push('invalid CSS: '+file+' '+error.message);continue}
 function visit(nodes,conditions=[]){
  for(const node of nodes){
   if(node.type==='atrule'&&['media','container','supports'].includes(node.name)){
    if(node.name==='media'){
     media++;
     const normalized=node.params.replace(/\s+/g,' ').trim();
     if(/\(hover:\s*hover\)/.test(normalized)&&!/\(pointer:\s*fine\)/.test(normalized)){
      errors.push(file+': (hover: hover) must also require (pointer: fine)');
     }
    }
    visit(node.nodes??[],[...conditions,'@'+node.name+' '+node.params.replace(/\s+/g,' ').trim()]);
    continue;
   }
   if(node.type!=='rule')continue;
   // Nested keyframes are animation steps, not regular selectors.
   if(node.parent?.type==='atrule'&&/keyframes/.test(node.parent.name))continue;
   rules++;
   for(const selector of postcss.list.comma(node.selector)){
    const key=conditions.join(' | ')+' :: '+selector.trim();
    const previous=owner.get(key);
    if(previous&&previous!==file)errors.push('selector has multiple owners: '+key+' ('+previous+', '+file+')');
    owner.set(key,file);
   }
   for(const decl of node.nodes){
    if(decl.type==='decl'&&decl.important)important++;
   }
  }
 }
 visit(root.nodes);
}
// Feature-local CSS is intentionally separate from global owner modules, but
// input-capability media queries must follow the same touch/pointer contract.
function checkLocalCSS(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const file=join(dir,entry.name);
  if(entry.isDirectory()){
   if(resolve(file)!==resolve(directory))checkLocalCSS(file);
  }else if(file.endsWith('.css')){
   const root=postcss.parse(readFileSync(file,'utf8'),{from:file});
   root.walkAtRules('media',node=>{
    const query=node.params.replace(/\s+/g,' ').trim();
    if(/\(hover:\s*hover\)/.test(query)&&!/\(pointer:\s*fine\)/.test(query))
     errors.push(file+': hover-capable pointer query must require (pointer: fine)');
   });
  }
 }
}
checkLocalCSS('web/src');
for(const token of required)
 if(!readFileSync(join(directory,'foundation/tokens.css'),'utf8').includes(token+':'))errors.push('missing design token: '+token);
if(important>110)errors.push('global CSS !important count increased beyond recorded baseline (110): '+important);
if(errors.length){console.error('Style ownership audit failed:\n'+errors.join('\n'));process.exitCode=1}
else console.log('Style architecture verified: '+all.length+' owned modules, '+rules+' rules, '+owner.size+' distinct scoped selectors, '+media+' media queries, '+important+' !important declarations; no cross-file owner conflicts');