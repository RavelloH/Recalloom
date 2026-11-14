import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import {normalizeKnownMarkdown} from './markdown-normalize';
import {projectRmdPreview} from './rmd-preview';
import {remarkRmdSyntax} from './rmd-remark';
import {analyzeRmd,shieldRmdTablePipes} from './rmd-lexer';
import {slugHeading} from './wiki-slug';

export type PreviewHastNode={type:string;tagName?:string;properties?:Record<string,unknown>;children?:PreviewHastNode[]};
/** The visual editor writes alignment as `style="text-align: …"`. Styles are
 *  never trusted, so the one supported value is carried as data-align. */
export function rehypeAlignment(){
 const walk=(node:PreviewHastNode)=>{
  const style=node.properties?.style;
  if(typeof style==='string'){
   const align=/text-align:\s*(left|center|right)/i.exec(style)?.[1]?.toLowerCase();
   if(align)node.properties!.dataAlign=align;
   delete node.properties!.style;
  }
  node.children?.forEach(walk);
 };
 return (tree:PreviewHastNode)=>walk(tree);
}
/** Attach stable, sanitized heading anchors without executing raw HTML. */
export function rehypeHeadingIds(){
 const labels=new Map<string,number>();
 const collect=(node:PreviewHastNode):string=>node.type==='text'?(node as PreviewHastNode&{value?:string}).value??'':(node.children??[]).map(collect).join('');
 const walk=(node:PreviewHastNode)=>{
  if(/^h[1-6]$/.test(node.tagName??'')){
   const supplied=node.properties?.id;
   const slug=typeof supplied==='string'&&/^[a-z][a-z0-9-]{0,79}$/i.test(supplied)
    ?supplied.toLowerCase():slugHeading(collect(node));
   if(slug){const count=labels.get(slug)??0;labels.set(slug,count+1);node.properties??={};node.properties.id=slug+(count?'-'+count:'');}
  }
  node.children?.forEach(walk);
 };
 return (tree:PreviewHastNode)=>walk(tree);
}
/** Fragment footnotes/headings must not share IDs with the live editor or peers. */
export function scopedPreviewIds(prefix:string){
 return function rehypeScopedIds(){
  const ids=new Set<string>();
  const collect=(node:PreviewHastNode)=>{
   if(typeof node.properties?.id==='string')ids.add(node.properties.id);
   node.children?.forEach(collect);
  };
  const resolve=(id:string)=>prefix+(ids.has(id)?id:ids.has('user-content-'+id)?'user-content-'+id:id);
  const walk=(node:PreviewHastNode)=>{
   const props=node.properties;
   if(typeof props?.id==='string')props.id=prefix+props.id;
   if(typeof props?.href==='string'&&props.href.startsWith('#'))props.href='#'+resolve(props.href.slice(1));
   for(const key of ['ariaDescribedBy','ariaLabelledBy']){
    const value=props?.[key];
    if(Array.isArray(value))props![key]=value.map(id=>resolve(String(id)));
    else if(typeof value==='string')props![key]=value.split(/\s+/).map(resolve).join(' ');
   }
   node.children?.forEach(walk);
  };
  return (tree:PreviewHastNode)=>{collect(tree);walk(tree);};
 };
}
const aligned=['p','h1','h2','h3','h4','h5','h6','th','td'];
export const previewSchema={
 ...defaultSchema,
 tagNames:[...(defaultSchema.tagNames??[]),'mark','u','wiki-ref','wiki-embed','rk-callout','rk-link-card','rk-critic','rk-badge','rk-abbr','rk-tooltip','rk-kbd','rk-cloze','rk-comment','rk-rmd-block-mark','rk-sketch','rk-sketch-block','rk-figure','rk-cross-ref','rk-numbered-math'],
 attributes:{...defaultSchema.attributes,...Object.fromEntries(aligned.map(tag=>[tag,[...(defaultSchema.attributes?.[tag]??[]),'dataAlign',...(tag.startsWith('h')||tag==='p'?['id']:[])]])),
  'wiki-ref':['dataTarget','dataAlias','dataAnchor'],
  'wiki-embed':['dataTarget','dataAnchor'],
  'rk-callout':['dataKind','dataTitle','dataSender','dataId'],
  'rk-rmd-block-mark':['dataRkColor','dataRkMathOnly','dataId'],
  'rk-sketch':['dataRkSketchKind','dataRkSketchColor','dataRkSketchStroke','dataRkSketchPadding','dataRkSketchRoughness','dataRkSketchOpacity'],
  'rk-sketch-block':['dataRkSketchKind','dataRkSketchColor','dataRkSketchStroke','dataRkSketchPadding','dataRkSketchRoughness','dataRkSketchOpacity','dataRkSketchMathOnly','dataId'],
  'rk-link-card':['dataUrl','dataTitle'],
  'rk-critic':['dataKind','dataValue','dataBefore'],
  'rk-badge':['dataVariant'],
  'rk-abbr':['dataTitle'],
  'rk-tooltip':['dataContent'],
  'rk-cloze':['dataHint'],
  'rk-figure':['dataPayload'],
  'rk-cross-ref':['dataId'],
  'rk-numbered-math':['dataId'],
  code:[...(defaultSchema.attributes?.code??[]),'id','dataFile','dataWrap','dataExpand'],
  table:[...(defaultSchema.attributes?.table??[]),'id','dataRmdCaption'],
  mark:[...(defaultSchema.attributes?.mark??[]),'dataRkColor']}
};

/** Keep fragment comparisons on the same projection and sanitization path as preview. */
export function prepareMarkdownPreview(content:string){
 const source=normalizeKnownMarkdown(projectRmdPreview(content).replace(/\r\n/g,'\n'));
 const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/.exec(source)?.[0]??null;
 const body=frontmatter?source.slice(frontmatter.length).replace(/^\n+/, ''):source;
 const analysis=analyzeRmd(body);
 return {frontmatter,body,analysis,parseSource:shieldRmdTablePipes(body,analysis)};
}

/** HAST before KaTeX: marking prose must never alter math or code inputs. */
export function previewComparisonTree(content:string):PreviewHastNode{
 const {body,analysis,parseSource}=prepareMarkdownPreview(content);
 const processor=unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(()=>remarkRmdSyntax(body,analysis))
  .use(remarkRehype,{allowDangerousHtml:true}).use(rehypeRaw)
  .use(rehypeAlignment).use(rehypeHeadingIds).use(rehypeSanitize,previewSchema);
 return processor.runSync(processor.parse(parseSource)) as PreviewHastNode;
}
