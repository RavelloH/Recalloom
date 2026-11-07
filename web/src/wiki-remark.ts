import {extractWikiReferences,type WikiOccurrence} from '../../src/wiki-syntax.js';

type Node={type:string;value?:string;children?:Node[];
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const safeAttribute=(value:string)=>encodeURIComponent(value).replace(/'/g,'%27');

/** Rewrites only Markdown AST text ranges and stand-alone paragraphs. Code,
 * links, math and HTML remain untouched. No unsafe user HTML is generated. */
export function wikiRemark(source:string){
 source=source.replace(/\r\n/g,'\n');
 const references=extractWikiReferences(source);
 let embedded=0;
 return (tree:Node)=>{
  const walk=(node:Node)=>{
   if(!node.children)return;
   const updated:Node[]=[];
   for(const child of node.children){
    if(child.type==='paragraph'&&child.children?.length===1){
     const from=child.position?.start?.offset;
     const candidate=from===undefined?undefined:references.find(ref=>ref.kind==='embed'&&ref.offset>=from&&
      ref.offset<(child.position?.end?.offset??from));
     if(candidate){
      if(embedded++<8){
       updated.push({type:'html',value:'<wiki-embed data-target="'+safeAttribute(candidate.target)+
        '" data-anchor="'+safeAttribute(candidate.anchor??'')+'"></wiki-embed>'});
      }else updated.push({type:'paragraph',children:[{type:'text',value:'嵌入内容过多，已折叠后续嵌入。'}]});
      continue;
     }
    }
    if(child.type==='text'){
     const from=child.position?.start?.offset,to=child.position?.end?.offset;
     if(from===undefined||to===undefined){updated.push(child);continue;}
     const matches=references.filter(r=>r.kind==='link'&&r.offset>=from&&r.offset<to);
     if(!matches.length){updated.push(child);continue;}
     let cursor=from;
     for(const ref of matches){
      if(ref.offset>cursor)updated.push({type:'text',value:source.slice(cursor,ref.offset)});
      updated.push({type:'html',value:'<wiki-ref data-target="'+safeAttribute(ref.target)+
       '" data-alias="'+safeAttribute(ref.alias??'')+
       '" data-anchor="'+safeAttribute(ref.anchor??'')+'"></wiki-ref>'});
      cursor=ref.offset+ref.raw.length;
     }
     if(cursor<to)updated.push({type:'text',value:source.slice(cursor,to)});
     continue;
    }
    if(!['code','inlineCode','math','inlineMath','html','link','linkReference','image','imageReference'].includes(child.type))
     walk(child);
    updated.push(child);
   }
   node.children=updated;
  };
  walk(tree);
 };
}
