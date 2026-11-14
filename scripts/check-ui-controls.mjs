// App controls use Astryx. These exceptions are document/interaction primitives,
// not alternative form controls; review them explicitly when changing behavior.
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';

const nativeTags=new Set(['button','input','select','textarea','summary']);
const interactiveRoles=new Set(['button','checkbox','combobox','radio','slider','switch']);
const exceptions=new Map([
 ['web/src/cloze-reveal.tsx:button:rk-cloze-reveal','Inline document cloze answer uses document typography and arbitrary inline children.'],
 ['web/src/shell.tsx:button:mobile-scrim','Navigation backdrop is an invisible dismiss surface.'],
 ['web/src/tiptap/block-handle.tsx:button:rk-block-drag','Native HTML drag source owns browser drag data and drag lifecycle.'],
 ['web/src/tiptap/rich-directives.tsx:button:rk-cloze-trigger','Inline document reveal preserves the mounted ProseMirror answer contentDOM.'],
 ['web/src/tiptap/rich-image.tsx:button:rk-rmd-attrs-decoration','Document attribute annotation matches the non-React ProseMirror widget.'],
 ['web/src/tiptap/rmd-attrs-decoration.ts:dom:button','ProseMirror decoration owns this non-React document annotation.'],
 ['web/src/tiptap/scroll-blocks.tsx:role:rk-code-title-hit','Direct code caption editing is a document text affordance.']
]);
const observed=new Set(),errors=[];
function walkFiles(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const file=directory+'/'+entry.name;
  if(entry.isDirectory())walkFiles(file);
  else if(/\.tsx?$/.test(file))inspect(file);
 }
}
function inspect(file){
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const fail=(node,key)=>{
  if(exceptions.has(key)){observed.add(key);return;}
  const {line}=source.getLineAndCharacterOfPosition(node.getStart(source));
  errors.push(file+':'+(line+1)+' '+key.split(':').slice(1).join(':')+' must use an Astryx control.');
 };
 function visit(node){
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   const tag=node.tagName.getText(source);
   const attributes=new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr=>[attr.name.getText(source),attr.initializer]));
   const initializer=attributes.get('className');
   const className=initializer?.getText(source)??'';
   const exceptionClass=[...exceptions.keys()].filter(key=>key.startsWith(file+':')).map(key=>key.split(':').at(-1))
    .find(name=>new RegExp('\\b'+name+'\\b').test(className))??'unclassified';
   if(nativeTags.has(tag))fail(node,file+':'+tag+':'+exceptionClass);
   const role=attributes.get('role');
   if(role&&ts.isStringLiteral(role)&&interactiveRoles.has(role.text)&&/^[a-z]/.test(tag)&&!nativeTags.has(tag))
    fail(node,file+':role:'+exceptionClass);
  }
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='createElement'){
   const tag=node.arguments[0];
   if(tag&&ts.isStringLiteral(tag)&&nativeTags.has(tag.text))fail(node,file+':dom:'+tag.text);
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
walkFiles('web/src');
for(const key of exceptions.keys())if(!observed.has(key))errors.push('Remove unused UI primitive exception: '+key);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('UI controls: Astryx forms and actions; '+observed.size+' reviewed document/interaction primitives.');
