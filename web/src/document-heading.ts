import {unified} from 'unified';
import remarkParse from 'remark-parse';

const parser=unified().use(remarkParse);
type MarkdownNode={
 type:string;
 depth?:number;
 value?:string;
 alt?:string;
 children?:MarkdownNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}};
};

export type PromotedHeading={
 title:string;
 before:string;
 headingSource:string;
 separator:string;
};

function plainText(node:MarkdownNode):string{
 if(node.type==='text'||node.type==='inlineCode'||node.type==='code')return node.value??'';
 if(node.type==='image')return node.alt??'';
 return node.children?.map(plainText).join('')??'';
}

/** Promote only a top-level H1 that is the first Markdown block.
 * A heading inside a list, quote, code fence, or below a paragraph is not promoted.
 * Blank lines before the first block are harmless. */
export function leadingDocumentHeading(markdown:string):PromotedHeading|null{
 const root=parser.parse(markdown) as MarkdownNode;
 const first=root.children?.[0];
 if(first?.type!=='heading'||first.depth!==1)return null;
 const start=first.position?.start?.offset,end=first.position?.end?.offset;
 if(start===undefined||end===undefined)return null;
 const remainder=markdown.slice(end);
 const separator=/^(?:\r?\n)+/.exec(remainder)?.[0]??'';
 return {title:plainText(first).replace(/\s+/g,' ').trim(),
  before:markdown.slice(0,start),headingSource:markdown.slice(start,end),separator};
}

export function headingPrefix(frame:PromotedHeading):string{
 return frame.before+frame.headingSource+frame.separator;
}

export function displayedDocumentBody(markdown:string,frame:PromotedHeading|null):string{
 if(!frame)return markdown;
 const prefix=headingPrefix(frame);
 // A restored draft may disagree with a stored heading. Never discard content.
 if(!markdown.startsWith(prefix))return markdown;
 const body=markdown.slice(prefix.length);
 // When the original file was only '# Title', inserting the first body block
 // requires a separator without surfacing it inside the visible editor.
 return !frame.separator&&body.startsWith('\n\n')?body.slice(2):body;
}

export function withDocumentBody(frame:PromotedHeading|null,body:string):string{
 if(!frame)return body;
 return frame.before+frame.headingSource+(frame.separator||(body?'\n\n':''))+body;
}

export function renameDocumentHeading(frame:PromotedHeading,title:string):PromotedHeading{
 // Only the heading block is rewritten. All preceding whitespace, separators,
 // remaining body text, and file metadata keep their original identity.
 return {...frame,title,headingSource:'# '+title};
}

/** Counts visible Unicode characters, rather than whitespace or Markdown delimiters.
 * Unlike word segmentation, this treats Chinese and English content consistently. */
export function markdownCharacterCount(markdown:string):number{
 const root=parser.parse(markdown) as MarkdownNode;
 const fragments:string[]=[];
 const walk=(node:MarkdownNode)=>{
  if(node.type==='text'||node.type==='inlineCode'||node.type==='code'||node.type==='math'||node.type==='inlineMath'){
   fragments.push(node.value??'');return;
  }
  if(node.type==='image'){fragments.push(node.alt??'');return;}
  node.children?.forEach(walk);
 };
 root.children?.forEach(walk);
 return Array.from(fragments.join('').replace(/\s/gu,'')).length;
}
