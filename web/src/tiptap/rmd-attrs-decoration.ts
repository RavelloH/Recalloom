import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import {formatRmdBlockAttrs} from '../rmd-serialize';

/** Source-aware editable node properties. The widget remains outside the
 * document model; opening it never edits content or creates a revision.
 * The editor commits validated node attributes only on explicit Save.
 */
export const RmdAttrsDecorations=Extension.create({
 name:'rmdAttrsDecorations',
 addProseMirrorPlugins(){
  return [new Plugin({
   props:{
    decorations(state){
     const items:Decoration[]=[];
     state.doc.descendants((node,pos)=>{
      if(['heading','paragraph','blockMath','table','codeBlock'].includes(node.type.name)){ /* Figure NodeView owns the image hint. */
       const value=formatRmdBlockAttrs(node.toJSON());
       if(value){
        const position=node.isTextblock?pos+node.nodeSize-1:pos+node.nodeSize;
        items.push(Decoration.widget(position,view=>{
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
          view.dom.dispatchEvent(new CustomEvent('rmd-edit-attrs',{bubbles:true,detail:{pos}}));
         });
         return el;
        },{side:1,key:'rk-attrs-'+pos+'-'+value,stopEvent:()=>true}));
       }
      }
      if(!node.isText||!node.text)return;
      // Only an apparent, closed attribute candidate at the end of a text
      // segment is decorated as invalid. Generic prose remains unstyled.
      const match=/(?:^|[\t ])(@ attrs(?:[ \t][^\r\n@]*?)?[ \t]+@)[ \t]*$/.exec(node.text);
      if(!match)return;
      const begin=node.text.lastIndexOf(match[1]!);
      if(begin<0)return;
      items.push(Decoration.inline(pos+begin,pos+begin+match[1]!.length,{
       class:'rk-rmd-invalid-attrs',title:'未识别的属性语法，按普通文字保留'
      }));
     });
     return DecorationSet.create(state.doc,items);
    }
   }
  })];
 }
});
