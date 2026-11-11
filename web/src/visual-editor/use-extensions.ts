import {useMemo} from 'react';
import StarterKit from '@tiptap/starter-kit';
import {RichImage} from '../tiptap/rich-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {RmdBlockMath} from '../tiptap/rmd-block-math';
import {InlineMath} from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import {CustomHeading} from '../tiptap/custom-heading';
import {CustomParagraph} from '../tiptap/custom-paragraph';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,TextAlignWithMarkdown} from '../tiptap/markdown-extensions';
import {TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown} from '../tiptap/table-with-markdown';
import {WikiLinkNode,WikiEmbedNode} from '../tiptap/wiki-nodes';
import {CrossReferenceNode} from '../tiptap/cross-reference';
import {ScrollCodeBlock,CaptionedScrollTableView} from '../tiptap/scroll-blocks';
import {RmdMark} from '../tiptap/rmd-mark';
import {RmdSketchMark} from '../tiptap/rmd-sketch';
import {RmdAttrsDecorations} from '../tiptap/rmd-attrs-decoration';
import {RawMarkdown,RawInline} from '../tiptap/raw-markdown';
import {RichContainer,RichBadge,RichAbbr,RichTooltip,RichKbd,RichCloze} from '../tiptap/rich-directives';
import {RichLinkCard} from '../tiptap/rich-link-card';
import {RichFootnoteRef,RichFootnoteDefinition} from '../tiptap/rich-footnotes';
import {RichCritic} from '../tiptap/rich-critic';
import {VisibleComment} from '../tiptap/comment-mark';
import Link from '@tiptap/extension-link';
import {type InsertDialogState} from '../tiptap/insert-dialog';
export function useVisualEditorExtensions(recordId:string|undefined,setDialog:(next:InsertDialogState|null)=>void){
return useMemo(()=>[
  StarterKit.configure({heading:false,paragraph:false,underline:false,codeBlock:false,link:false,
    // ProseMirror's default drop cursor has no base CSS class and uses a
    // hardcoded color; identify it explicitly so text and block drags differ.
    dropcursor:{class:'rk-editor-dropcursor',color:false,width:3}}),
  Link.configure({openOnClick:false}),
  ScrollCodeBlock.configure({defaultTheme:'github-light-high-contrast',themes:{light:'github-light-high-contrast',dark:'github-dark-high-contrast'}}),
  CustomHeading.configure({levels:[1,2,3,4,5,6]}),
  CustomParagraph,
  RawMarkdown,RawInline,RmdAttrsDecorations,
  WikiLinkNode.configure({sourceId:recordId}),WikiEmbedNode.configure({sourceId:recordId}),CrossReferenceNode,
  RichImage.configure({allowBase64:false}),
  TableWithMarkdown.configure({resizable:false,View:CaptionedScrollTableView}),TableRowWithMarkdown,TableHeaderWithMarkdown,TableCellWithMarkdown,
  TaskList,TaskItem.configure({nested:true}),
  UnderlineWithMarkdown,RmdMark,RmdSketchMark,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,
  RichContainer,RichBadge,RichAbbr,RichTooltip,RichKbd,RichCloze,RichCritic,RichLinkCard,RichFootnoteRef,RichFootnoteDefinition,VisibleComment,
  TextAlignWithMarkdown.configure({types:['heading','paragraph'],alignments:['left','center','right']}),
  InlineMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'inline',latex:String(node.attrs.latex??''),position:pos,existing:true})}),
  RmdBlockMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'block',latex:String(node.attrs.latex??''),position:pos,existing:true,equationId:String(node.attrs.equationId??'')})}),
  Placeholder.configure({placeholder:({editor:e,node})=>node.type.name==='heading'?'标题 '+String(node.attrs.level??''):e.isEmpty?'输入“/”插入内容，或直接开始写作…':'输入“/”插入块'}),
 ],[recordId]);
}
