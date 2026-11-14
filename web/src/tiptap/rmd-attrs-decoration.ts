import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {Extension} from '@tiptap/core';
import {Plugin,PluginKey,type Transaction} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import {formatRmdBlockAttrs} from '../rmd-serialize';

const attrsKey=new PluginKey<DecorationSet>('rmdAttrsDecorations');
const eligible=new Set(['heading','paragraph','blockMath','table','codeBlock']);

/** Build widgets only for nodes intersecting the supplied range. This avoids
 * visiting an entire large document for an ordinary character insertion.
 */
/** Resolve the current owner after insertions before a mapped widget. */
function ownerPosition(doc:ProseMirrorNode,widgetPos:number,type:string):number|null{
 const resolved=doc.resolve(widgetPos);
 for(let depth=resolved.depth;depth>0;depth--){
  if(resolved.node(depth).type.name===type)return resolved.before(depth);
 }
 const preceding=resolved.nodeBefore;
 return preceding?.type.name===type?widgetPos-preceding.nodeSize:null;
}

function itemsInRange(doc:ProseMirrorNode,from=0,to=doc.content.size):Decoration[]{
 const items:Decoration[]=[];
 doc.nodesBetween(from,to,(node,pos)=>{
  if(eligible.has(node.type.name)){
   // Only attributes are required for the small label. Serializing the
   // content of every paragraph/code block would be unnecessary.
   const value=formatRmdBlockAttrs({type:node.type.name,attrs:node.attrs});
   if(value){
    const position=node.isTextblock?pos+node.nodeSize-1:pos+node.nodeSize;
    items.push(Decoration.widget(position,(view,getPos)=>{
     const el=document.createElement('button');
     el.type='button';
     el.className='rk-rmd-attrs-decoration';
     el.dataset.rkAttrsKind=node.type.name;
     el.textContent=value;
     el.contentEditable='false';
     el.setAttribute('aria-label','编辑 Markdown 属性：'+value);
     el.title='点击或按 Enter 修改当前块的 Markdown 属性';
     el.addEventListener('mousedown',event=>event.preventDefault());
     el.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const widgetPos=getPos();
      const currentPos=widgetPos===undefined?null:ownerPosition(view.state.doc,widgetPos,node.type.name);
      if(currentPos!==null)view.dom.dispatchEvent(new CustomEvent('rmd-edit-attrs',{bubbles:true,detail:{pos:currentPos}}));
     });
     return el;
    // A block widget at the boundary belongs to the preceding block. Keep it
    // attached there when the next sibling is replaced in its entirety.
    },{side:node.isTextblock?1:-1,key:'rk-attrs-'+pos+'-'+value,stopEvent:()=>true}));
   }
  }
  if(!node.isText||!node.text)return;
  // An invalid @ attrs candidate is shown as ordinary editable text.
  const match=/(?:^|[\t ])(@ attrs(?:[ \t][^\r\n@]*?)?[ \t]+@)[ \t]*$/.exec(node.text);
  if(!match)return;
  const begin=node.text.lastIndexOf(match[1]!);
  if(begin<0)return;
  items.push(Decoration.inline(pos+begin,pos+begin+match[1]!.length,{
   class:'rk-rmd-invalid-attrs',title:'未识别的属性语法，按普通文字保留'
  }));
 });
 return items;
}

function rebuild(doc:ProseMirrorNode):DecorationSet{
 return DecorationSet.create(doc,itemsInRange(doc));
}

/** Dirty ranges at the top level are a deliberately conservative boundary:
 * a nested container is refreshed as a unit. All other blocks are reused
 * with ProseMirror's transaction mapping, including widgets after inserts.
 */
function changedTopLevelRanges(tr:Transaction):Array<{from:number;to:number}>|null{
 if(tr.mapping.maps.length!==1)return null;
 const ranges:Array<{from:number;to:number}>=[];
 tr.mapping.maps[0]!.forEach((_oldStart,_oldEnd,newStart,newEnd)=>{
  const start=Math.max(0,newStart-1),end=Math.min(tr.doc.content.size,newEnd+1);
  tr.doc.nodesBetween(start,end,(node,pos,parent)=>{
   if(parent===tr.doc){ranges.push({from:pos,to:pos+node.nodeSize});return false;}
  });
 });
 if(!ranges.length||ranges.length>32)return null;
 ranges.sort((a,b)=>a.from-b.from);
 const merged:Array<{from:number;to:number}>=[];
 for(const range of ranges){
  const previous=merged.at(-1);
  if(previous&&range.from<=previous.to)previous.to=Math.max(previous.to,range.to);
  else merged.push({...range});
 }
 return merged;
}

export const RmdAttrsDecorations=Extension.create({
 name:'rmdAttrsDecorations',
 addProseMirrorPlugins(){
  return [new Plugin<DecorationSet>({
   key:attrsKey,
   state:{
    init(_,state){return rebuild(state.doc);},
    apply(tr,current){
     if(!tr.docChanged)return current;
     const ranges=changedTopLevelRanges(tr);
     if(!ranges)return rebuild(tr.doc);
     let mapped=current.map(tr.mapping,tr.doc);
     for(const range of ranges){
      // Widgets at the start boundary belong to the unchanged prior block.
      const existing=mapped.find(range.from,range.to).filter(item=>item.from!==range.from||item.to!==range.from);
      if(existing.length)mapped=mapped.remove(existing);
      const added=itemsInRange(tr.doc,range.from,range.to);
      if(added.length)mapped=mapped.add(tr.doc,added);
     }
     return mapped;
    }
   },
   props:{decorations(state){return attrsKey.getState(state)??DecorationSet.empty;}}
  })];
 }
});
