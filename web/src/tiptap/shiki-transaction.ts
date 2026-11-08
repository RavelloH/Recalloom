import {Plugin,type Transaction,type StateField} from '@tiptap/pm/state';
import type {Node as PMNode} from '@tiptap/pm/model';
import {DecorationSet} from '@tiptap/pm/view';

/** The upstream Shiki extension traverses every code block on EVERY
 * transaction, including cursor moves and unrelated paragraph typing.
 * Code-block highlighting needs to change only when code-block content or
 * attributes actually change (or its async highlighter becomes available).
 */
function containsCodeBlock(doc:PMNode,from:number,to:number):boolean{
 const start=Math.max(0,Math.min(from-1,doc.content.size));
 const end=Math.min(doc.content.size,Math.max(start+1,to+1));
 let found=false;
 doc.nodesBetween(start,end,node=>{
  if(node.type.name==='codeBlock'){found=true;return false;}
  return !found;
 });
 return found;
}

export function codeHighlightMayChange(tr:Transaction):boolean{
 if(!tr.docChanged)return false;
 if(tr.mapping.maps.length!==1)return true;
 let covered=false;
 let touched=false;
 tr.mapping.maps[0]!.forEach((oldStart,oldEnd,newStart,newEnd)=>{
  covered=true;
  if(containsCodeBlock(tr.before,oldStart,oldEnd)||containsCodeBlock(tr.doc,newStart,newEnd))touched=true;
 });
 return !covered||touched;
}

/** Wrap rather than replace the upstream tokenizer/renderer. This preserves
 * its Shiki syntax colors, theme support, VS Code paste logic and fallback.
 * Only ProseMirror's update scheduling is optimized; no source-level caching.
 */
export function optimizeShikiPlugins(plugins:Plugin[]):Plugin[]{
 return plugins.map(plugin=>{
  const key=plugin.spec.key as ({key?:string})|undefined;
  if(!key?.key?.startsWith('shiki$')||!plugin.spec.state)return plugin;
  const original=plugin.spec;
  const state=original.state as StateField<DecorationSet>;
  let pendingCheck=false;
  return new Plugin<DecorationSet>({
   ...original,
   state:{
    ...state,
    apply(tr,decorations,oldState,newState){
     const forced=Boolean(tr.getMeta('shikiPluginForceDecoration'));
     const touchesCode=codeHighlightMayChange(tr);
     if(!forced&&!touchesCode){
      // Mapping existing token decorations is sufficient for edits elsewhere.
      return tr.docChanged?decorations.map(tr.mapping,tr.doc):decorations;
     }
     pendingCheck=true;
     return state.apply(tr,decorations,oldState,newState);
    }
   },
   view(view){
    const upstream=original.view?.(view);
    return {
     update(current,previous){
      if(!pendingCheck)return;
      pendingCheck=false;
      upstream?.update?.(current,previous);
     },
     destroy(){upstream?.destroy?.();}
    };
   }
  });
 });
}
