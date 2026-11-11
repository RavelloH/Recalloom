import {Extension} from '@tiptap/core';
import './format-hover-preview.css';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import type {Editor} from '@tiptap/core';

export type FormatHoverKind =
 | 'bold'|'italic'|'strike'|'underline'|'mark'|'code'|'blockquote'
 | 'superscript'|'subscript'|'comment'
 | `heading:${number}` | 'align:left'|'align:center'|'align:right'
 | 'list:bullet'|'list:ordered'|'list:task'
 | `sketch:${string}` | `rich:${string}` | `remove:${string}`;

type HoverRange={kind:FormatHoverKind;from:number;to:number};

/** Transient UI decoration, NEVER a document mark or content mutation.
 * addToHistory=false and preventUpdate ensure hover is not a revision,
 * doesn't dirty the editor, and never enters the undo stack.
 */
const hoverKey=new PluginKey<HoverRange|null>('rkFormatHoverPreview');
const blockKinds=new Set(['blockquote','align:left','align:center','align:right','list:bullet','list:ordered','list:task']);
function previewDecorations(state:import('@tiptap/pm/state').EditorState):DecorationSet{
 const range=hoverKey.getState(state);
 if(!range)return DecorationSet.empty;
 const {doc}=state;
 const from=Math.max(0,Math.min(range.from,doc.content.size));
 const to=Math.max(from,Math.min(range.to,doc.content.size));
 const kind=range.kind;
 const isHeading=kind.startsWith('heading:');
 if(isHeading||blockKinds.has(kind)||kind==='remove:blockquote'||kind.startsWith('remove:list:')){
  const items:Decoration[]=[];
  const visitFrom=Math.max(0,from===to?from-1:from);
  const visitTo=Math.min(doc.content.size,Math.max(to,from+1));
  doc.nodesBetween(visitFrom,visitTo,(node,pos)=>{
   if(node.isTextblock){
    const cls=isHeading?'heading':kind.replaceAll(':','-');
    const level=isHeading?String(Math.max(0,Math.min(6,Number(kind.slice(8))||0))):'';
    items.push(Decoration.node(pos,pos+node.nodeSize,{
     class:'rk-hover-format rk-hover-format--block rk-hover-format--'+cls,
     ...(level?{'data-rk-preview-level':level}:{})
    }));
    return false;
   }
  });
  return items.length?DecorationSet.create(doc,items):DecorationSet.empty;
 }
 if(from>=to)return DecorationSet.empty;
 const cls=kind.startsWith('sketch:')?'sketch':kind.replaceAll(':','-');
 const sketch=kind.startsWith('sketch:');
 // ProseMirror splits inline decorations at mark boundaries (e.g. bold).
 // All DOM fragments from this one selection must share a drawing group.
 const extras=sketch?{
  'data-rk-preview-sketch':'true',
  'data-rk-preview-group':kind+':'+from+':'+to,
  'data-rk-sketch-kind':kind.slice(7)
 }:{};
 return DecorationSet.create(doc,[Decoration.inline(from,to,{
  class:'rk-hover-format rk-hover-format--'+cls+(sketch?' rk-sketch-inline':''),
  ...extras
 })]);
}

export const FormatHoverPreview=Extension.create({
 name:'rkFormatHoverPreview',
 addProseMirrorPlugins(){
  return [new Plugin<HoverRange|null>({
   key:hoverKey,
   state:{
    init:()=>null,
    apply(tr,current){
     const meta=tr.getMeta(hoverKey) as HoverRange|null|undefined;
     if(meta!==undefined)return meta;
     return tr.docChanged?null:current;
    }
   },
   props:{decorations:previewDecorations}
  })];
 }
});

/** Dispatch only plugin metadata; the underlying document is untouched. */
export function setFormatHoverPreview(editor:Editor,kind:FormatHoverKind|null,from?:number,to?:number){
 const state=editor.state;
 const previous=hoverKey.getState(state);
 if(!kind){if(!previous)return;editor.view.dispatch(state.tr.setMeta(hoverKey,null).setMeta('addToHistory',false).setMeta('preventUpdate',true));return;}
 const start=from??state.selection.from,end=to??state.selection.to;
 const next={kind,from:Math.min(start,end),to:Math.max(start,end)};
 if(previous?.kind===kind&&previous.from===next.from&&previous.to===next.to)return;
 editor.view.dispatch(state.tr.setMeta(hoverKey,next).setMeta('addToHistory',false).setMeta('preventUpdate',true));
}
