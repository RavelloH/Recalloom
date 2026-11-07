import type {Editor} from '@tiptap/core';
import {Pilcrow,Heading1,Heading2,Heading3,List,ListOrdered,ListChecks,Quote,SquareCode,SeparatorHorizontal,Table2,Link2,ImagePlus,Sigma,SquareSigma,AlignLeft,AlignCenter,AlignRight,MessageSquareWarning,ChevronsDown,Tag,Highlighter,MessageCircle,MessagesSquare,Footprints,Network,PanelsTopLeft,BookOpenCheck,Keyboard,type LucideIcon} from 'lucide-react';

export type SlashHelpers={openLink:()=>void;openImage:()=>void;openMath:(type:'inline'|'block')=>void};
export type SlashCommand={
 id:string;title:string;description:string;keywords:string[];icon:LucideIcon;
 run:(editor:Editor,helpers:SlashHelpers)=>void;
 isAvailable?:(editor:Editor)=>boolean;
};

const chain=(editor:Editor)=>editor.chain().focus();
export const slashCommands:SlashCommand[]=[
 {id:'text',title:'正文',description:'普通段落文本',keywords:['text','paragraph','p','zw'],icon:Pilcrow,run:e=>chain(e).setParagraph().run()},
 {id:'h1',title:'一级标题',description:'大号章节标题',keywords:['h1','heading','title','bt'],icon:Heading1,run:e=>chain(e).setHeading({level:1}).run()},
 {id:'h2',title:'二级标题',description:'中号章节标题',keywords:['h2','heading','subtitle','bt'],icon:Heading2,run:e=>chain(e).setHeading({level:2}).run()},
 {id:'h3',title:'三级标题',description:'小号章节标题',keywords:['h3','heading','bt'],icon:Heading3,run:e=>chain(e).setHeading({level:3}).run()},
 {id:'bullet',title:'项目列表',description:'无序的要点列表',keywords:['ul','bullet','list','lb'],icon:List,run:e=>chain(e).toggleBulletList().run()},
 {id:'ordered',title:'编号列表',description:'带序号的步骤列表',keywords:['ol','number','ordered','list','bh'],icon:ListOrdered,run:e=>chain(e).toggleOrderedList().run()},
 {id:'todo',title:'待办清单',description:'可勾选的任务项',keywords:['todo','task','check','checkbox','db'],icon:ListChecks,run:e=>chain(e).toggleTaskList().run()},
 {id:'quote',title:'引用',description:'引用或强调一段话',keywords:['quote','blockquote','yy'],icon:Quote,run:e=>chain(e).toggleBlockquote().run()},
 {id:'code',title:'代码块',description:'等宽字体的代码片段',keywords:['code','pre','snippet','dm'],icon:SquareCode,run:e=>chain(e).toggleCodeBlock().run()},
 {id:'callout',title:'提示横幅',description:'插入 Astryx 风格提示容器',keywords:['callout','warning','banner','tip','alert','ts'],icon:MessageSquareWarning,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'warning',title:'注意'},content:[{type:'paragraph',content:[{type:'text',text:'请在此输入提示内容'}]}]}).run()},
 {id:'details',title:'折叠内容',description:'插入可以折叠的内容区域',keywords:['details','fold','collapse','zd'],icon:ChevronsDown,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'details',title:'详细内容'},content:[{type:'paragraph',content:[{type:'text',text:'补充说明'}]}]}).run()},
 {id:'badge',title:'行内徽标',description:'插入状态或版本标签',keywords:['badge','tag','label','bz'],icon:Tag,run:e=>chain(e).insertContent({type:'richBadge',attrs:{variant:'info'},content:[{type:'text',text:'状态'}]}).run()},
 {id:'comment',title:'弱化注释',description:'在所选文字上添加可见注释',keywords:['comment','note','annotation','zs'],icon:MessageCircle,run:e=>chain(e).setMark('visibleComment').run()},
 {id:'color-highlight',title:'彩色高亮',description:'将选择内容设为红色主题高亮',keywords:['color','highlight','mark','gl'],icon:Highlighter,run:e=>chain(e).setHighlight({color:'red'}).run()},
 {id:'tabs',title:'标签页',description:'插入 Astryx 标签导航与可编辑内容面板',keywords:['tabs','tab','fenye','qiehuan'],icon:PanelsTopLeft,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'tabs'},content:[{type:'richContainer',attrs:{kind:'tab',title:'示例'},content:[{type:'paragraph',content:[{type:'text',text:'第一项内容'}]}]},{type:'richContainer',attrs:{kind:'tab',title:'说明'},content:[{type:'paragraph',content:[{type:'text',text:'第二项内容'}]}]}]}).run()},
 {id:'flashcard',title:'学习闪卡',description:'问题与答案分开编辑，阅读时折叠答案',keywords:['flashcard','card','study','quiz','fuxi'],icon:BookOpenCheck,
  run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'flashcard',title:'知识闪卡'},content:[
   {type:'richContainer',attrs:{kind:'front',title:'问题'},content:[{type:'paragraph',content:[{type:'text',text:'在此输入问题'}]}]},
   {type:'richContainer',attrs:{kind:'back',title:'答案'},content:[{type:'paragraph',content:[{type:'text',text:'在此输入答案'}]}]}
  ]}).run()},
 {id:'cloze',title:'复习挖空',description:'插入可在阅读态揭示答案的 Cloze 提示',keywords:['cloze','blank','fill','study','wankong'],icon:Highlighter,
  run:e=>chain(e).insertContent({type:'richCloze',attrs:{hint:'点击揭示'},content:[{type:'text',text:'答案'}]}).run()},
 {id:'kbd',title:'快捷键键帽',description:'插入 Ctrl+Shift+P 等快捷键提示',keywords:['kbd','keyboard','shortcut','keycap','anjian'],icon:Keyboard,
  run:e=>chain(e).insertContent({type:'richKbd',content:[{type:'text',text:'Ctrl+Shift+P'}]}).run()},
 {id:'chat',title:'对话记录',description:'插入 Astryx 聊天气泡和多 Agent 消息',keywords:['chat','agent','messages','duihua'],icon:MessagesSquare,run:e=>chain(e).insertContent({type:'richContainer',attrs:{kind:'chat'},content:[{type:'richContainer',attrs:{kind:'message',title:'Agent',sender:'assistant'},content:[{type:'paragraph',content:[{type:'text',text:'Agent 的观点'}]}]},{type:'richContainer',attrs:{kind:'message',title:'User',sender:'user'},content:[{type:'paragraph',content:[{type:'text',text:'用户的回复'}]}]}]}).run()},
 {id:'link-card',title:'链接卡片',description:'从原文 URL 获取站点预览内容',keywords:['linkcard','card','link','url','kapian'],icon:Link2,run:e=>chain(e).insertContent({type:'richLinkCard',attrs:{url:'https://example.com/'}}).run()},
 {id:'footnote',title:'脚注引用',description:'插入 GFM 脚注引用，随后添加同名定义',keywords:['footnote','reference','cite','jiaozhu'],icon:Footprints,run:e=>chain(e).insertContent({type:'richFootnoteRef',attrs:{id:'note'}}).run()},
 {id:'mermaid',title:'Mermaid 图表',description:'插入可编辑的流程图代码及安全预览',keywords:['mermaid','diagram','flowchart','graph','tu'],icon:Network,run:e=>chain(e).insertContent({type:'codeBlock',attrs:{language:'mermaid'},content:[{type:'text',text:'flowchart LR\n  A[开始] --> B[完成]'}]}).run()},
 {id:'divider',title:'分割线',description:'在内容之间插入分隔',keywords:['hr','divider','line','separator','fgx'],icon:SeparatorHorizontal,run:e=>chain(e).setHorizontalRule().run()},
 {id:'table',title:'表格',description:'插入 3×3 表格',keywords:['table','grid','bg'],icon:Table2,run:e=>chain(e).insertTable({rows:3,cols:3,withHeaderRow:true}).run(),isAvailable:e=>!e.isActive('table')},
 {id:'link',title:'链接',description:'插入网页或内部链接',keywords:['link','url','href','lj'],icon:Link2,run:(_e,h)=>h.openLink()},
 {id:'image',title:'图片',description:'通过地址插入外部图片',keywords:['image','img','picture','photo','tp'],icon:ImagePlus,run:(_e,h)=>h.openImage()},
 {id:'inline-math',title:'行内公式',description:'在文字中插入 LaTeX 公式',keywords:['math','inline','latex','formula','gs'],icon:Sigma,run:(_e,h)=>h.openMath('inline')},
 {id:'block-math',title:'块级公式',description:'独占一行的 LaTeX 公式',keywords:['math','block','latex','formula','equation','gs'],icon:SquareSigma,run:(_e,h)=>h.openMath('block')},
 {id:'align-left',title:'左对齐',description:'将当前段落左对齐',keywords:['align','left','dq'],icon:AlignLeft,run:e=>chain(e).setTextAlign('left').run(),isAvailable:e=>!e.isActive('codeBlock')},
 {id:'align-center',title:'居中对齐',description:'将当前段落居中',keywords:['align','center','dq'],icon:AlignCenter,run:e=>chain(e).setTextAlign('center').run(),isAvailable:e=>!e.isActive('codeBlock')},
 {id:'align-right',title:'右对齐',description:'将当前段落右对齐',keywords:['align','right','dq'],icon:AlignRight,run:e=>chain(e).setTextAlign('right').run(),isAvailable:e=>!e.isActive('codeBlock')}
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
