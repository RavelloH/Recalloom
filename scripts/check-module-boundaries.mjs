import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,extname} from 'node:path';
import ts from 'typescript';

const errors=[];
const modules=[
 {entry:'web/src/pages.tsx',directory:'web/src/pages',public:['PageTitle','LoginPage','HomePage','LibraryPage','ArchivePage','RecordPage','TasksPage','SearchPage','ActivityPage','SettingsPage']},
 {entry:'src/storage.ts',directory:'src/storage',public:['getRecord','revisionContent','createFolder','browse','archivedRecords','createRecord','readRecord','editRecord','restoreRecord','listVersions','listRecordEditors','updateMeta','tagRecord','taskOperation','getTasks','changesSince','manageFolder','resolvePath']},
 {entry:'web/src/visual-editor.tsx',directory:'web/src/visual-editor',public:['default','VisualEditorHandle']}
];
const sf=(filename)=>ts.createSourceFile(filename,readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,filename.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
const locate=(origin,relative)=>{
 const file=resolve(dirname(origin),relative);
 const candidates=[file,file+'.ts',file+'.tsx',file.replace(/\.js$/i,'.ts'),file.replace(/\.js$/i,'.tsx')];
 return candidates.find(existsSync);
};
for(const {entry,directory,public:expected} of modules){
 const tree=sf(entry),names=[],files=[];
 for(const node of tree.statements){
  if(!ts.isExportDeclaration(node)||!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier)||!node.exportClause||!ts.isNamedExports(node.exportClause)){
   errors.push(entry+': compatibility entry must consist only of explicit re-exports');
   continue;
  }
  for(const el of node.exportClause.elements)names.push(el.name.text);
  const location=locate(entry,node.moduleSpecifier.text);
  if(!location)errors.push(entry+': missing re-export target '+node.moduleSpecifier.text);
  else if(!location.replaceAll('\\','/').includes(directory+'/'))errors.push(entry+': public exports must live in '+directory);
 }
 const sorted=x=>[...x].sort().join('|');
 if(sorted(names)!==sorted(expected))errors.push(entry+': public export contract changed (actual '+sorted(names)+')');
 const graph=new Map();
 for(const name of readdirSync(directory).filter(p=>/\.(ts|tsx)$/.test(p))){
  const file=join(directory,name),parsed=sf(file),deps=[];
  files.push(file);
  for(const node of parsed.statements){
   if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;
   const m=node.moduleSpecifier;
   if(!m||!ts.isStringLiteral(m))continue;
   const source=m.text;
   const legacy='../'+entry.split('/').at(-1).replace(/\.(?:tsx?|jsx?)$/,'');
   if(source===legacy||source===legacy+'.js'||source===legacy+'.tsx')errors.push(file+': do not import compatibility entry '+entry);
   if(!source.startsWith('.'))continue;
   const target=locate(file,source);
   if(target && resolve(target).replaceAll('\\','/').startsWith(resolve(directory).replaceAll('\\','/')+'/'))deps.push(target.replaceAll('\\','/'));
  }
  graph.set(file.replaceAll('\\','/'),deps);
 }
 const state=new Map(),stack=[];
 function visit(file){
  if(state.get(file)===2)return;
  if(state.get(file)===1){errors.push('cyclic feature dependency: '+[...stack,file].join(' -> '));return;}
  state.set(file,1);stack.push(file);
  for(const dep of graph.get(file)??[])visit(dep);
  stack.pop();state.set(file,2);
 }
 for(const file of graph.keys())visit(file);
 console.log(entry+': '+expected.length+' public exports, '+files.length+' implementation modules, acyclic graph');
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('Module boundaries verified');
