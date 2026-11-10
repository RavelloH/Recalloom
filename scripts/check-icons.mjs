import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';

const root='web/src',exceptions=new Set(['web/src/icon.ts']);
const found=[],errors=[],names=new Set(),glyphs=new Map();
const registry=readFileSync('web/src/icon.ts','utf8');
for(const match of registry.matchAll(/^\s+([a-z]\w*):Icon([A-Z]\w*),\s*$/gm)){
 if(names.has(match[1]))errors.push('duplicate icon name '+match[1]);
 names.add(match[1]);
 if(glyphs.has(match[2]))errors.push('duplicate visual glyph ('+match[2]+'): '+glyphs.get(match[2])+', '+match[1]);
 glyphs.set(match[2],match[1]);
}
assert.ok(names.size>100,'expected the complete semantic glyph vocabulary');
function scan(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory()){scan(path);continue}
  if(!/\.(ts|tsx)$/.test(entry.name))continue;
  const file=path.replaceAll('\\','/'),src=readFileSync(path,'utf8');
  const sf=ts.createSourceFile(path,src,ts.ScriptTarget.Latest,true,entry.name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if(src.includes('rk-icon-frame'))errors.push(file+': legacy icon frame is prohibited');
  for(const statement of sf.statements)
   if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text==='@tabler/icons-react'&&!exceptions.has(file))
    errors.push(file+': import icons only through icon.tsx');
  function visit(node){
   if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(sf)==='Icon'){
    found.push(file);
    const attr=(name)=>node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(sf)===name);
    const name=attr('name'),size=attr('size');
    if(!name)errors.push(file+': Icon is missing name');
    else if(name.initializer&&ts.isStringLiteral(name.initializer)&&!names.has(name.initializer.text))
      errors.push(file+': unknown icon semantic name '+name.initializer.text);
    if(size&&(!size.initializer||!ts.isStringLiteral(size.initializer)||!['sm','md','lg'].includes(size.initializer.text)))
      errors.push(file+': Icon size must be sm/md/lg');
    if(['stroke','strokeWidth','width','height'].some(a=>attr(a)))errors.push(file+': Icon stroke/dimensions are owned by the primitive');
   }
   ts.forEachChild(node,visit);
  }
  visit(sf);
 }
}
scan(root);
const css=readFileSync('web/src/styles/icons.css','utf8');
if(css.includes('rk-icon-frame')||!css.includes('.rk-icon'))errors.push('styles/icons.css contains legacy frame or lacks primitive');
for(const token of ['sm','md','lg'])
 if(!readFileSync('web/src/styles/foundation/tokens.css','utf8').includes('--rk-icon-'+token+':'))
  errors.push('missing icon size token '+token);
if(errors.length)throw Error('Icon audit failed:\n'+errors.join('\n'));
console.log('Icon system verified: '+names.size+' semantic glyphs, '+glyphs.size+' unique visuals, '+found.length+' component usages; 0 feature Tabler imports, 0 legacy icon frames');
