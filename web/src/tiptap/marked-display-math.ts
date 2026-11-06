type MdNode={type:string;value?:string;children?:MdNode[];data?:Record<string,unknown>};

/** A standalone <mark>...</mark> wrapper around display math is supported
 * explicitly. Markdown's HTML-block rule otherwise swallows $$ as raw HTML.
 * Require a dedicated wrapper and $$ on their own lines; inline KaTeX is
 * handled by the ordinary inline highlighter. */
export function markedDisplayLatex(source:string):string|null {
 const match=/^[ \t]*<mark>[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*<\/mark>[ \t]*$/i.exec(source);
 if(!match)return null;
 const latex=match[1]?.trim()??'';
 return latex&& !latex.includes('$$') ?latex:null;
}
type MdChild=MdNode;
type MathNode={type:'math';value:string};
/** Detect both a single HTML-block token and the HTML + math + HTML triplet
 * emitted when blank lines separate the three pieces. */
export function findMarkedDisplayMath(nodes:readonly MdChild[],index:number):{latex:string;length:number}|null {
 const node=nodes[index];
 if(!node)return null;
 if(node.type==='html'){
  const entire=markedDisplayLatex(node.value??'');
  if(entire)return {latex:entire,length:1};
  if(/^<mark>\s*$/i.test(node.value??'')){
   const math=nodes[index+1] as MathNode|undefined;
   const close=nodes[index+2];
   if(math?.type==='math'&&close?.type==='html'&&/^<\/mark>\s*$/i.test(close.value??''))
    return {latex:math.value,length:3};
  }
 }
 return null;
}
/** Preserve preview styling through ReactMarkdown's rehype sanitize pass.
 * The custom parent is a HAST div containing a real math node, allowing
 * rehype-katex to process the child as ordinary display math. */
export function remarkMarkedDisplayMath(){
 return (tree:MdNode)=>{
  const nodes=tree.children??[];
  for(let i=0;i<nodes.length;i++){
   const match=findMarkedDisplayMath(nodes,i);
   if(!match)continue;
   // Rehype-raw builds the same safe pre > code.language-math tree that
   // remark-math normally generates. Rehype-katex can then render it *inside*
   // a highlight wrapper. Escape user LaTeX as HTML text before parsing.
   const escaped=match.latex.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
   nodes.splice(i,match.length,{type:'html',value:
    '<div data-highlighted-math="true"><pre><code class="language-math">'+escaped+'</code></pre></div>'});
  }
 };
}
