import type {Editor} from '@tiptap/core';
import {runInlineRmdCommand} from './editor-inline-commands';
import {extraBlockCommands} from './editor-block-commands';
// Import command augmentations explicitly; the retired Markdown plugin no longer
// supplies them transitively to the editor's TypeScript compilation.
import type {} from '@tiptap/extension-task-list';
import type {} from '@tiptap/extension-code-block';
import type {} from '@tiptap/extension-heading';
import type {} from '@tiptap/extension-paragraph';
import type {} from '@tiptap/extension-highlight';
import type {} from '@tiptap/extension-table';
import type {} from '@tiptap/extension-text-align';
import {IconPilcrow,IconH1,IconH2,IconH3,IconH4,IconH5,IconH6,IconList,IconListNumbers,IconListCheck,IconQuote,IconCodeDots,IconSeparatorHorizontal,IconTable,IconLink,IconPhotoPlus,IconMathFunction,IconSum,IconAlignLeft,IconAlignCenter,IconAlignRight,IconMessageExclamation,IconChevronsDown,IconTag,IconHighlight,IconMessageCircle,IconMessages,IconNotes,IconLayoutNavbar,IconVocabulary,IconCards,IconSchema,IconBrowser,IconEyeQuestion,IconKeyboard,type TablerIcon} from '@tabler/icons-react';

export type SlashHelpers={openLink:()=>void;openImage:()=>void;openMath:(type:'inline'|'block')=>void;openWikiEmbed?:()=>void};
export type SlashCommand={
 id:string;title:string;description:string;keywords:string[];icon:TablerIcon;
 run:(editor:Editor,helpers:SlashHelpers)=>void;
 isAvailable?:(editor:Editor)=>boolean;
};
export type SlashCommandCategory='basic'|'layout'|'callout'|'sketch'|'study'|'reference'|'media'|'format'|'inline';
export type SlashCommandGroup={id:SlashCommandCategory;label:string;commands:SlashCommand[]};
const slashCategoryLabels:Readonly<Record<SlashCommandCategory,string>>={
 basic:'基础',layout:'布局',callout:'提示',sketch:'手绘',study:'学习',reference:'引用',media:'媒体',format:'格式',inline:'行内'
};
const slashCategoryOrder:readonly SlashCommandCategory[]=['basic','layout','callout','sketch','study','reference','media','format','inline'];
function slashCategory(id:string):SlashCommandCategory{
 if(id.startsWith('rmd-block:')){
  const syntax=id.slice('rmd-block:'.length);
  const command=extraBlockCommands.find(item=>item.syntax===syntax);
  if(command?.category==='callout')return 'callout';
  if(command?.category==='annotation')return 'sketch';
  if(command?.category==='child')return ['front','back','definition'].includes(syntax)?'study':'layout';
 }
 if(['callout'].includes(id))return 'callout';
 if(['color-highlight'].includes(id))return 'sketch';
 if(['details','tabs','chat','table'].includes(id))return 'layout';
 if(['flashcard','cloze','glossary'].includes(id))return 'study';
 if(['wiki-embed','link-card','footnote','footnote-definition','comment','link'].includes(id))return 'reference';
 if(['image','inline-math','block-math','mermaid'].includes(id))return 'media';
 if(id.startsWith('align-'))return 'format';
 if(['badge','kbd'].includes(id))return 'inline';
 return 'basic';
}
export function groupSlashCommands(commands:readonly SlashCommand[]):SlashCommandGroup[]{
 return slashCategoryOrder.flatMap(id=>{
  const matching=commands.filter(command=>slashCategory(command.id)===id);
  return matching.length?[{id,label:slashCategoryLabels[id],commands:matching}]:[];
 });
}

const chain=(editor:Editor)=>editor.chain().focus();
export const slashCommands:SlashCommand[]=[
 {id:'text',title:'正文',description:'普通段落文本',keywords:['text','paragraph','p','zw'],icon:IconPilcrow,run:e=>chain(e).setParagraph().run()},
 {id:'h1',title:'一级标题',description:'大号章节标题',keywords:['h1','heading','title','bt'],icon:IconH1,run:e=>chain(e).setHeading({level:1}).run()},
 {id:'h2',title:'二级标题',description:'中号章节标题',keywords:['h2','heading','subtitle','bt'],icon:IconH2,run:e=>chain(e).setHeading({level:2}).run()},
 {id:'h3',title:'三级标题',description:'小号章节标题',keywords:['h3','heading','bt'],icon:IconH3,run:e=>chain(e).setHeading({level:3}).run()},
 {id:'h4',title:'四级标题',description:'更小的章节标题',keywords:['h4','heading','bt'],icon:IconH4,run:e=>chain(e).setHeading({level:4}).run()},
 {id:'h5',title:'五级标题',description:'第五级章节标题',keywords:['h5','heading','bt'],icon:IconH5,run:e=>chain(e).setHeading({level:5}).run()},
 {id:'h6',title:'六级标题',description:'第六级章节标题',keywords:['h6','heading','bt'],icon:IconH6,run:e=>chain(e).setHeading({level:6}).run()},
 {id:'bullet',title:'项目列表',description:'无序的要点列表',keywords:['ul','bullet','list','lb'],icon:IconList,run:e=>chain(e).toggleBulletList().run()},
 {id:'ordered',title:'编号列表',description:'带序号的步骤列表',keywords:['ol','number','ordered','list','bh'],icon:IconListNumbers,run:e=>chain(e).toggleOrderedList().run()},
 {id:'todo',title:'待办清单',description:'可勾选的任务项',keywords:['todo','task','check','checkbox','db'],icon:IconListCheck,run:e=>chain(e).toggleTaskList().run()},
 {id:'quote',title:'引用',description:'引用或强调一段话',keywords:['quote','blockquote','yy'],icon:IconQuote,run:e=>chain(e).toggleWrap('blockquote').run()},
 {id:'code',title:'代码块',description:'等宽字体的代码片段',keywords:['code','pre','snippet','dm'],icon:IconCodeDots,run:e=>chain(e).toggleCodeBlock().run()},
 {id:'callout',title:'提示横幅',description:'插入 Astryx 风格提示容器',keywords:['callout','warning','banner','tip','alert','ts'],icon:IconMessageExclamation,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'warning',title:'注意'},content:[{type:'paragraph',content:[{type:'text',text:'请在此输入提示内容'}]}]}).run()},
 ...extraBlockCommands.map(item=>({id:'rmd-block:'+item.syntax,title:item.title,description:item.category==='child'?'在合法父容器中添加子块':'插入 RMD '+item.syntax+' 块',keywords:[...item.keywords],icon:item.category==='annotation'?IconHighlight:IconMessageExclamation,run:(e:Editor)=>{item.run(e);},isAvailable:item.isAvailable})),
 {id:'wiki-embed',title:'嵌入 Wiki 文档',description:'搜索并嵌入只读文档投影',keywords:['embed','wiki','嵌入','文档'],icon:IconBrowser,run:(_e,h)=>h.openWikiEmbed?.()},
 {id:'details',title:'折叠内容',description:'插入可以折叠的内容区域',keywords:['details','fold','collapse','zd'],icon:IconChevronsDown,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'details',title:'详细内容'},content:[{type:'paragraph',content:[{type:'text',text:'补充说明'}]}]}).run()},
 {id:'badge',title:'行内徽标',description:'插入状态或版本标签',keywords:['badge','tag','label','bz'],icon:IconTag,run:e=>chain(e).insertContent({type:'richBadge',attrs:{variant:'info'},content:[{type:'text',text:'状态'}]}).run()},
 {id:'comment',title:'弱化注释',description:'在所选文字上添加可见注释',keywords:['comment','note','annotation','zs'],icon:IconMessageCircle,run:e=>chain(e).setMark('visibleComment').run()},
 {id:'color-highlight',title:'手绘荧光笔',description:'使用默认黄色静态手绘荧光笔',keywords:['color','highlight','mark','gl'],icon:IconHighlight,run:e=>{runInlineRmdCommand(e,'highlight');}},
 {id:'tabs',title:'标签页',description:'插入 Astryx 标签导航与可编辑内容面板',keywords:['tabs','tab','fenye','qiehuan'],icon:IconLayoutNavbar,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'tabs'},content:[{type:'richContainer',attrs:{kind:'tab',title:'示例'},content:[{type:'paragraph',content:[{type:'text',text:'第一项内容'}]}]},{type:'richContainer',attrs:{kind:'tab',title:'说明'},content:[{type:'paragraph',content:[{type:'text',text:'第二项内容'}]}]}]}).run()},
 {id:'glossary',title:'术语定义列表',description:'插入有明确范围的术语与定义，可直接编辑',keywords:['definition','glossary','term','cibiao','shuyu'],icon:IconVocabulary,
  run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'glossary',title:'术语表'},content:[
   {type:'richContainer',attrs:{kind:'definition',title:'DO'},content:[{type:'paragraph',content:[{type:'text',text:'Durable Objects'}]}]},
   {type:'richContainer',attrs:{kind:'definition',title:'D1'},content:[{type:'paragraph',content:[{type:'text',text:'Cloudflare SQL 数据库'}]}]}
  ]}).run()},
 {id:'flashcard',title:'学习闪卡',description:'问题与答案分开编辑，可视化编辑器中折叠答案',keywords:['flashcard','card','study','quiz','fuxi'],icon:IconCards,
  run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'flashcard',title:'知识闪卡'},content:[
   {type:'richContainer',attrs:{kind:'front',title:'问题'},content:[{type:'paragraph',content:[{type:'text',text:'在此输入问题'}]}]},
   {type:'richContainer',attrs:{kind:'back',title:'答案'},content:[{type:'paragraph',content:[{type:'text',text:'在此输入答案'}]}]}
  ]}).run()},
 {id:'cloze',title:'复习挖空',description:'插入可在可视化编辑器中揭示答案的 Cloze 提示',keywords:['cloze','blank','fill','study','wankong'],icon:IconEyeQuestion,
  run:e=>chain(e).insertContent({type:'richCloze',attrs:{hint:'点击揭示'},content:[{type:'text',text:'答案'}]}).run()},
 {id:'kbd',title:'快捷键键帽',description:'插入 Ctrl+Shift+P 等快捷键提示',keywords:['kbd','keyboard','shortcut','keycap','anjian'],icon:IconKeyboard,
  run:e=>chain(e).insertContent(['Ctrl','Shift','P'].flatMap((key,i)=>[
   ...(i?[{type:'text',text:' + '}]:[]),
   {type:'richKbd',content:[{type:'text',text:key}]}
  ])).run()},
 {id:'chat',title:'对话记录',description:'插入 Astryx 聊天气泡和多 Agent 消息',keywords:['chat','agent','messages','duihua'],icon:IconMessages,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'chat'},content:[{type:'richContainer',attrs:{kind:'message',title:'Agent',sender:'assistant'},content:[{type:'paragraph',content:[{type:'text',text:'Agent 的观点'}]}]},{type:'richContainer',attrs:{kind:'message',title:'User',sender:'user'},content:[{type:'paragraph',content:[{type:'text',text:'用户的回复'}]}]}]}).run()},
 {id:'link-card',title:'链接卡片',description:'从原文 URL 获取站点预览内容',keywords:['linkcard','card','link','url','kapian'],icon:IconBrowser,run:e=>chain(e).insertContent({type:'richLinkCard',attrs:{url:'https://example.com/'}}).run()},
 {id:'footnote',title:'脚注引用',description:'插入 GFM 脚注引用，随后添加同名定义',keywords:['footnote','reference','cite','jiaozhu'],icon:IconNotes,run:e=>chain(e).insertContent({type:'richFootnoteRef',attrs:{id:'note'}}).run()},
 {id:'footnote-definition',title:'脚注定义',description:'插入与脚注引用对应的可编辑 GFM 脚注定义',keywords:['footnote','definition','note','jiaozhu','dingyi'],icon:IconNotes,
  run:e=>chain(e).insertContent({type:'richFootnoteDefinition',attrs:{id:'note'},content:[{type:'paragraph',content:[{type:'text',text:'脚注说明'}]}]}).run()},
 {id:'mermaid',title:'Mermaid 图表',description:'插入可编辑的流程图代码及安全预览',keywords:['mermaid','diagram','flowchart','graph','tu'],icon:IconSchema,run:e=>chain(e).insertContent({type:'codeBlock',attrs:{language:'mermaid'},content:[{type:'text',text:'flowchart LR\n  A[开始] --> B[完成]'}]}).run()},
 {id:'divider',title:'分割线',description:'在内容之间插入分隔',keywords:['hr','divider','line','separator','fgx'],icon:IconSeparatorHorizontal,run:e=>chain(e).insertContent({type:'horizontalRule'}).run()},
 {id:'table',title:'表格',description:'插入 3×3 表格',keywords:['table','grid','bg'],icon:IconTable,run:e=>chain(e).insertTable({rows:3,cols:3,withHeaderRow:true}).run(),isAvailable:e=>!e.isActive('table')},
 {id:'link',title:'链接',description:'插入网页或内部链接',keywords:['link','url','href','lj'],icon:IconLink,run:(_e,h)=>h.openLink()},
 {id:'image',title:'图片',description:'通过地址插入外部图片',keywords:['image','img','picture','photo','tp'],icon:IconPhotoPlus,run:(_e,h)=>h.openImage()},
 {id:'inline-math',title:'行内公式',description:'在文字中插入 LaTeX 公式',keywords:['math','inline','latex','formula','gs'],icon:IconMathFunction,run:(_e,h)=>h.openMath('inline')},
 {id:'block-math',title:'块级公式',description:'独占一行的 LaTeX 公式',keywords:['math','block','latex','formula','equation','gs'],icon:IconSum,run:(_e,h)=>h.openMath('block')},
 {id:'align-left',title:'左对齐',description:'将当前段落左对齐',keywords:['align','left','dq'],icon:IconAlignLeft,run:e=>chain(e).setTextAlign('left').run(),isAvailable:e=>!e.isActive('codeBlock')},
 {id:'align-center',title:'居中对齐',description:'将当前段落居中',keywords:['align','center','dq'],icon:IconAlignCenter,run:e=>chain(e).setTextAlign('center').run(),isAvailable:e=>!e.isActive('codeBlock')},
 {id:'align-right',title:'右对齐',description:'将当前段落右对齐',keywords:['align','right','dq'],icon:IconAlignRight,run:e=>chain(e).setTextAlign('right').run(),isAvailable:e=>!e.isActive('codeBlock')}
];

export function filterSlashCommands(editor:Editor,query:string){
 const term=query.trim().toLowerCase();
 const filtered=slashCommands.filter(command=>(command.isAvailable?.(editor)??true)&&(!term
  ||command.title.toLowerCase().includes(term)
  ||command.keywords.some(keyword=>keyword.startsWith(term))));
 if(!term)return filtered;
 // An exact title must win over partial matches: /链接 opens the link dialog,
 // while /链接卡片 inserts LinkCard. Preserve original order for ties.
 return filtered.sort((a,b)=>Number(b.title.toLowerCase()===term)-Number(a.title.toLowerCase()===term));
}

/** Matches a "/query" typed at the start of a block or after whitespace. */
export function matchSlashQuery(textBeforeCursor:string){
 const match=/(?:^|\s)\/([^\s/]{0,24})$/.exec(textBeforeCursor);
 return match?match[1]!:null;
}
