import type {Editor} from '@tiptap/core';
import {Pilcrow,Heading1,Heading2,Heading3,List,ListOrdered,ListChecks,Quote,SquareCode,SeparatorHorizontal,Table2,Link2,ImagePlus,Sigma,SquareSigma,AlignLeft,AlignCenter,AlignRight,type LucideIcon} from 'lucide-react';

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
 return slashCommands.filter(command=>(command.isAvailable?.(editor)??true)&&(!term
  ||command.title.toLowerCase().includes(term)
  ||command.keywords.some(keyword=>keyword.startsWith(term))));
}

/** Matches a "/query" typed at the start of a block or after whitespace. */
export function matchSlashQuery(textBeforeCursor:string){
 const match=/(?:^|\s)\/([^\s/]{0,24})$/.exec(textBeforeCursor);
 return match?match[1]!:null;
}
