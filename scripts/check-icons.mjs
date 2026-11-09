// Keep Recalloom's glyph vocabulary and sizing coherent across new features.
// This is intentionally a static check: no browser or production data needed.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';

const root='web/src';
const failures=[];
let files=0,uses=0,relativeSizes=0;
const findFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const file=join(dir,entry.name);
 return entry.isDirectory()?findFiles(file):/\.(ts|tsx)$/.test(entry.name)?[file]:[];
});
const srcFiles=findFiles(root);
for(const file of srcFiles){
 const src=readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const locals=new Set();
 for(const statement of sf.statements){
  if(!ts.isImportDeclaration(statement))continue;
  const from=statement.moduleSpecifier.text;
  if(from==='lucide-react')failures.push(file+': disallowed Lucide import');
  if(from!=='@tabler/icons-react')continue;
  const named=statement.importClause?.namedBindings;
  if(named&&ts.isNamedImports(named))for(const name of named.elements){
   if(!name.isTypeOnly&&name.name.text.startsWith('Icon'))locals.add(name.name.text);
  }
 }
 if(!locals.size)continue;
 files++;
 function inspect(node){
  if(ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node)){
   if(locals.has(node.tagName.getText(sf))){
    uses++;
    const size=node.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='size');
    if(size){
     const literal=size.initializer;
     if(literal&&ts.isStringLiteral(literal)&&/^(?:\d+(?:\.\d+)?)em$/.test(literal.text))relativeSizes++;
     else failures.push(file+': icon uses non-em size near line '+(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1));
    }
    for(const attr of node.attributes.properties)if(ts.isJsxAttribute(attr)&&attr.name.text==='strokeWidth')
     failures.push(file+': Tabler icon uses Lucide strokeWidth prop');
   }
  }
  ts.forEachChild(node,inspect);
 }
 inspect(sf);
}
const pkg=JSON.parse(readFileSync('package.json','utf8'));
assert.ok(pkg.dependencies['@tabler/icons-react'],'Tabler must be a direct dependency');
if(pkg.dependencies['lucide-react'])failures.push('package.json: legacy Lucide dependency');
if(failures.length)throw Error('Icon system checks failed:\n'+failures.join('\n'));
console.log('Icon system verified: '+files+' files, '+uses+' direct Tabler JSX icons, '+relativeSizes+' relative em sizes; no Lucide imports');
