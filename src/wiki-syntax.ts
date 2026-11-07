import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/** The syntax parser is shared by storage, preview and the Tiptap editor.
 * A bare name is NEVER an authoritative reference. */
export const wikiUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type WikiKind='link'|'embed';
export type WikiTarget={target:string;anchor:string|null;alias:string|null};
export type WikiOccurrence=WikiTarget&{kind:WikiKind;raw:string;offset:number};

const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type TreeNode={
 type:string;value?:string;children?:TreeNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}};
};
const validPath=(path:string)=>path.startsWith('/')&&path.length<=2048
 &&!path.includes('//')&&path!=='/'&&!path.split('/').includes('.')&&!path.split('/').includes('..')
 &&!/[<>\r\n]/.test(path);

/** Parse the explicit target in [[id:uuid]], [[/absolute/path.md]],
 * {{embed:id:uuid}}. The #heading and |alias are optional.
 * Do not resolve names or infer paths from the current folder. */
export function parseWikiTarget(raw:string,allowAlias=true):WikiTarget|null{
 const source=raw.trim();
 const separator=allowAlias?source.indexOf('|'):-1;
 const expression=separator<0?source:source.slice(0,separator).trim();
 const alias=separator<0?null:source.slice(separator+1).trim();
 if(!expression||separator>=0&&(!alias||alias.length>180))return null;
 const hash=expression.indexOf('#');
 const base=(hash<0?expression:expression.slice(0,hash)).trim();
 const anchor=hash<0?null:expression.slice(hash+1).trim();
 if(hash>=0&&(!anchor||anchor.length>180))return null;
 if(base.startsWith('id:')){
  const id=base.slice(3);
  if(!wikiUuid.test(id))return null;
  return {target:'id:'+id.toLowerCase(),anchor,alias};
 }
 if(!validPath(base))return null;
 return {target:base,anchor,alias};
}

function escaped(input:string,index:number){
 let slashes=0;
 for(let i=index-1;i>=0&&input[i]==='\\';i--)slashes++;
 return slashes%2===1;
}
const recognized=/\[\[([^\]\r\n]{1,2048})\]\]/g;
/** Return only syntactically valid refs from Markdown prose; skip fenced/inline
 * code, HTML, existing Markdown links, images, escaped syntax and math. */
export function extractWikiReferences(content:string):WikiOccurrence[]{
 const refs:WikiOccurrence[]=[];
 const normalized=content.replace(/\r\n/g,'\n');
 const tree=parser.parse(normalized) as TreeNode;
 const visit=(node:TreeNode,parent?:TreeNode)=>{
  if(node.type==='paragraph'){
   const start=node.position?.start?.offset,end=node.position?.end?.offset;
   if(start!==undefined&&end!==undefined&&node.children?.length===1&&node.children[0]?.type==='text'){
    const body=normalized.slice(start,end).trim();
    if(body.startsWith('{{embed:')&&body.endsWith('}}')&&body.indexOf('\n')<0){
     const parsed=parseWikiTarget(body.slice(8,-2),false);
     if(parsed){
      refs.push({...parsed,kind:'embed',raw:body,offset:start+normalized.slice(start,end).indexOf(body)});
      return;
     }
    }
   }
  }
  if(node.type==='text'){
   const from=node.position?.start?.offset,to=node.position?.end?.offset;
   if(from!==undefined&&to!==undefined){
    const raw=normalized.slice(from,to);
    for(const m of raw.matchAll(recognized)){
     const idx=m.index??0;
     if(escaped(raw,idx)||escaped(normalized,from+idx))continue;
     const parsed=parseWikiTarget(m[1]??'');
     if(parsed)refs.push({...parsed,kind:'link',raw:m[0],offset:from+idx});
    }
   }
   return;
  }
  // Markdown's normal links should remain hyperlinks, not nested wiki links.
  if(['code','inlineCode','html','link','linkReference','image','imageReference',
      'math','inlineMath','definition'].includes(node.type))return;
  for(const child of node.children??[])visit(child,node);
 };
 visit(tree);
 return refs.sort((a,b)=>a.offset-b.offset);
}
