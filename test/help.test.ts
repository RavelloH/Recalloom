import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {HELP_TOPICS,getHelp,listHelpResources} from '../src/help/index.js';
import {markedDisplayLatex} from '../web/src/tiptap/marked-display-math';
import {extractWikiReferences,parseWikiTarget} from '../src/wiki-syntax.js';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {BlockMathWithHighlight} from '../web/src/tiptap/block-math-highlight';
import {InlineMathWithHighlight} from '../web/src/tiptap/inline-math-highlight';
import {HighlightWithMarkdown} from '../web/src/tiptap/markdown-extensions';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {wikiRemark} from '../web/src/wiki-remark';

const examples=(doc:string)=>[...doc.matchAll(/~~~markdown\n([\s\S]*?)\n~~~/g)].map(x=>x[1]);
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);

test('help catalog has nine documented topics with stable resource URIs',()=>{
 assert.deepEqual(HELP_TOPICS,['overview','markdown','math','wiki','editing','versions','search','tasks','backup']);
 const resources=listHelpResources();
 assert.equal(resources.length,10);
 assert.equal(resources[0].topic,'index');
 assert.match(resources[0].content,/math.*LaTeX|math.*公式|math.*数学/);
 for(const topic of HELP_TOPICS){
  const page=getHelp(topic);
  assert.equal(page.uri,'recalloom://help/'+topic);
  assert.ok(page.content.startsWith('# '));
  assert.ok(page.content.length>400);
  assert.ok(page.summary.length>5);
  assert.ok(resources.some(r=>r.uri===page.uri&&r.content===page.content));
  assert.ok(parser.parse(page.content).children.length>=2,'invalid document: '+topic);
 }
});
test('documented block-level marked formula follows the real parser rules',()=>{
 const math=getHelp('math').content;
 const blocks=examples(math);
 assert.ok(blocks.length>=4,'expected inline, block and highlighted examples');
 const marked=blocks.find(x=>x.startsWith('<mark>\n$$\n'));
 assert.ok(marked,'missing explicit block-level marked math sample');
 const latex=markedDisplayLatex(marked);
 assert.ok(latex);
 assert.match(latex!,/\\begin\{aligned\}/);
 assert.match(latex!,/\\frac/);
 const plain=blocks.find(x=>x.startsWith('$$\n'));
 assert.ok(plain);
 const nodes=parser.parse(plain!);
 assert.equal(nodes.children[0]?.type,'math');
 const inline=blocks.find(x=>x.includes('<mark>$'));
 assert.ok(inline);
 assert.match(inline!,/<mark>\$\\frac/);
 const bad='<mark>$$x^2$$</mark>';
 assert.equal(markedDisplayLatex(bad),null);
});
test('documented WikiLink and embed samples resolve to the intended kinds',()=>{
 const wiki=getHelp('wiki').content;
 const snippets=examples(wiki);
 assert.ok(snippets.length>=2);
 const links=extractWikiReferences(snippets[0]);
 assert.equal(links.length,3);
 assert.ok(links.every(x=>x.kind==='link'));
 assert.ok(links.some(x=>x.alias==='变压器空载试验'&&x.anchor==='空载试验'));
 assert.ok(links.some(x=>x.target==='/Projects/电力系统分析/核心知识.md'));
 const embeds=extractWikiReferences(snippets[1]);
 assert.equal(embeds.length,3);
 assert.ok(embeds.every(x=>x.kind==='embed'));
 assert.ok(embeds.some(x=>x.anchor==='总结'));
 assert.equal(parseWikiTarget('核心知识'),null,'bare names must not become identities');
 const escaped=extractWikiReferences('~~~md\n[[id:11111111-1111-4111-8111-111111111111]]\n~~~');
 assert.equal(escaped.length,0,'fenced code cannot become a reference');
});
test('Markdown help explicitly distinguishes supported and unsupported formats',()=>{
 const md=getHelp('markdown').content;
 assert.match(md,/CommonMark\/GFM/);
 assert.match(md,/KaTeX/);
 assert.match(md,/<mark>/);
 assert.match(md,/<sup>/);
 assert.match(md,/<sub>/);
 assert.match(md,/不.*任意.*HTML/);
 const parsed=parser.parse(md);
 assert.ok(parsed.children.some(x=>x.type==='code'),'must contain fenced syntax examples');
});


test('help metadata exposes a deterministic content fingerprint for clients',()=>{
 const index=getHelp();
 assert.equal(index.schemaVersion,1);
 assert.match(index.helpVersion,/^1\.[a-f0-9]{12}$/);
 assert.match(index.contentHash,/^[a-f0-9]{64}$/);
 assert.ok(index.helpVersion.endsWith(index.contentHash.slice(0,12)));
 assert.ok(index.content.includes(index.contentHash));
 for(const topic of HELP_TOPICS){
  const page=getHelp(topic);
  assert.equal(page.helpVersion,index.helpVersion);
  assert.equal(page.contentHash,index.contentHash);
  assert.equal(page.schemaVersion,index.schemaVersion);
 }
});

const editorManager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false}),
 CustomHeading,CustomParagraph,Markdown,HighlightWithMarkdown,
 InlineMathWithHighlight,BlockMathWithHighlight
]});
type VisualNode={type?:string;attrs?:Record<string,unknown>;marks?:{type:string}[];content?:VisualNode[]};
const flatten=(root:VisualNode):VisualNode[]=>[root,...(root.content??[]).flatMap(flatten)];

test('published math examples survive real Tiptap import, serialization and reopen',()=>{
 const blocks=examples(getHelp('math').content);
 const highlighted=blocks.find(x=>x.startsWith('<mark>\n$$\n'));
 assert.ok(highlighted);
 const imported=buildVisualMarkdown(highlighted,editorManager);
 const rendered=flatten(imported).find(x=>x.type==='blockMath');
 assert.equal(rendered?.attrs?.highlighted,true);
 assert.match(String(rendered?.attrs?.latex),/\\frac/);
 const saved=editorManager.serialize(imported);
 assert.match(saved,/^<mark>\n\$\$\n/);
 const restored=buildVisualMarkdown(saved,editorManager);
 const reopened=flatten(restored).find(x=>x.type==='blockMath');
 assert.equal(reopened?.attrs?.highlighted,true);
 assert.equal(reopened?.attrs?.latex,rendered?.attrs?.latex);
 const inline=blocks.find(x=>x.includes('<mark>$'));
 assert.ok(inline);
 const visual=buildVisualMarkdown(inline,editorManager);
 const atoms=flatten(visual).filter(x=>x.type==='inlineMath');
 assert.equal(atoms.length,1,'highlighted inline fraction should be a real inline math node');
 assert.ok(atoms[0]?.marks?.some(x=>x.type==='highlight'));
 const savedInline=editorManager.serialize(visual);
 assert.match(savedInline,/<mark>\$\\frac/);
 const reopenedInline=flatten(buildVisualMarkdown(savedInline,editorManager)).find(x=>x.type==='inlineMath');
 assert.ok(reopenedInline?.marks?.some(x=>x.type==='highlight'));
 assert.equal(reopenedInline?.attrs?.latex,atoms[0]?.attrs?.latex);
});

test('published Markdown mark and Wiki samples go through actual editor and preview AST transformations',()=>{
 const markdown=examples(getHelp('markdown').content);
 const marked=markdown.find(x=>x.includes('<mark>结论及'));
 assert.ok(marked);
 const markedNodes=flatten(buildVisualMarkdown(marked,editorManager));
 assert.ok(markedNodes.some(x=>x.type==='text'&&x.marks?.some(m=>m.type==='highlight')));
 const saved=editorManager.serialize(buildVisualMarkdown(marked,editorManager));
 assert.match(saved,/<mark>/);
 assert.match(saved,/U_N/);
 const wikiExamples=examples(getHelp('wiki').content);
 for(const [index,kind,count] of [[0,'wiki-ref',3],[1,'wiki-embed',3]] as const){
  const source=wikiExamples[index];
  assert.ok(source);
  const ast=parser.parse(source);
  wikiRemark(source)(ast as any);
  const html=JSON.stringify(ast);
  const found=html.split('<'+kind+' ').length-1;
  assert.equal(found,count,kind+' should survive the actual preview AST transformation: '+html.slice(0,600));
 }
});
