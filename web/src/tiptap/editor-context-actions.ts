/**
 * Target-specific desktop context actions. Never add these to the touch UI:
 * touch users must retain the native selection/copy/translate popover.
 */
import type {Editor} from '@tiptap/core';
import {CellSelection} from '@tiptap/pm/tables';
import type {DropdownMenuItemData} from '@astryxdesign/core/DropdownMenu';

export type Feedback=(message:string)=>void;
const safeWeb=(url:string)=>{
 try{const parsed=new URL(url,location.href);return ['https:','http:','mailto:'].includes(parsed.protocol)?parsed.href:null;}
 catch{return null;}
};
const clipboardHelp='浏览器无法读取剪贴板，请使用 Ctrl+V（Mac 上为 ⌘V）粘贴。';
export async function pasteFromClipboard(editor:Editor,notify:Feedback):Promise<void>{
 if(!navigator.clipboard?.read){
  notify(clipboardHelp);
  return;
 }
 try{
  const items=await navigator.clipboard.read();
  if(!items.length){notify('剪贴板为空');return;}
  const data=new DataTransfer();
  let html='',plain='';
  for(const item of items){
   if(item.types.includes('text/html')&&!html)
    html=await (await item.getType('text/html')).text();
   if(item.types.includes('text/plain')&&!plain)
    plain=await (await item.getType('text/plain')).text();
   if(item.types.includes('image/png')){
    const blob=await item.getType('image/png');
    data.items.add(new File([blob],'clipboard.png',{type:'image/png'}));
   }
  }
  if(html)data.setData('text/html',html);
  if(plain)data.setData('text/plain',plain);
  if(!html&&!plain&&!data.files.length){notify('此浏览器不支持粘贴剪贴板中的内容，请使用 Ctrl+V');return;}
  // Hand the payload to ProseMirror's own native paste parser/handlers.
  // Avoid editor.commands.insertContent(html), which bypasses clipboard rules.
  editor.view.focus();
  const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
  editor.view.dom.dispatchEvent(event);
  if(!event.defaultPrevented){
   // Browsers such as Firefox can refuse synthetic ClipboardEvent handling.
   // In that case only insert *plain text*, never untrusted HTML as markup.
   if(plain)editor.chain().focus().insertContent(plain).run();
   else notify(clipboardHelp);
  }
 }catch{notify(clipboardHelp);}
}
export async function copyImage(src:string,notify:Feedback):Promise<void>{
 if(!navigator.clipboard?.write||!('ClipboardItem' in window)){
  notify('浏览器不支持复制图片；可打开原图后使用系统复制。');return;
 }
 try{
  const response=await fetch(src,{mode:'cors'});
  if(!response.ok)throw new Error('fetch');
  let blob=await response.blob();
  if(blob.type!=='image/png'){
   const bitmap=await createImageBitmap(blob);
   try{
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');
    ctx.drawImage(bitmap,0,0);
    const png=await new Promise<Blob>((ok,fail)=>canvas.toBlob(value=>value?ok(value):fail(Error('png')),'image/png'));
    blob=png;
   }finally{bitmap.close();}
  }
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
  notify('图片已复制');
 }catch{notify('复制图片受跨域或剪贴板权限限制，请打开原图后使用浏览器复制。');}
}
export async function downloadImage(src:string,notify:Feedback):Promise<void>{
 try{
  const response=await fetch(src,{mode:'cors'});
  if(!response.ok)throw new Error('fetch');
  const blob=await response.blob();
  const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
  const objectUrl=URL.createObjectURL(blob);
  try{
   const link=document.createElement('a');
   link.href=objectUrl;link.download='recalloom-image.'+ext;
   document.body.appendChild(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),5000);}
 }catch{
  const link=document.createElement('a');
  link.href=src;link.target='_blank';link.rel='noopener noreferrer';
  link.click();
  notify('图片不允许跨域下载，已尝试打开原图，可通过浏览器另存为。');
 }
}
export function linkContextItems(editor:Editor,href:string,at:number,
 onEdit:()=>void,notify:Feedback):DropdownMenuItemData[]{
 const url=safeWeb(href);
 return [
  {id:'link-open',label:'打开链接',isDisabled:!url,
   onClick:()=>{if(url)window.open(url,'_blank','noopener,noreferrer');}},
  {id:'link-copy',label:'复制链接',isDisabled:!url,
   onClick:()=>{if(url)void navigator.clipboard.writeText(url).catch(()=>notify('无法复制链接，请检查浏览器剪贴板权限。'));}},
  {id:'link-edit',label:'编辑链接',onClick:()=>{editor.chain().focus().setTextSelection(at).run();onEdit();}},
  {id:'link-unset',label:'移除链接',
   onClick:()=>editor.chain().focus().setTextSelection(at).extendMarkRange('link').unsetLink().run()}
 ];
}
export function imageContextItems(src:string,notify:Feedback):DropdownMenuItemData[]{
 return [
  {id:'image-download',label:'下载图片',onClick:()=>void downloadImage(src,notify)},
  {id:'image-copy',label:'复制图片',onClick:()=>void copyImage(src,notify)}
 ];
}
export function tableContextItems(editor:Editor,pos:number):DropdownMenuItemData[]{
 const cmd=(method:'addRowBefore'|'addRowAfter'|'deleteRow'|'addColumnBefore'|'addColumnAfter'|'deleteColumn'|'mergeCells'|'splitCell')=>()=>{
  // Preserve multi-cell CellSelection for merge/split. Collapsing it to a
  // text caret before merge makes the operation impossible.
  if((method==='mergeCells'||method==='splitCell')&&editor.state.selection instanceof CellSelection)
   return editor.chain().focus()[method]().run();
  return editor.chain().focus().setTextSelection(pos)[method]().run();
 };
 return [
  {id:'table-row-before',label:'在上方插入行',onClick:cmd('addRowBefore')},
  {id:'table-row-after',label:'在下方插入行',onClick:cmd('addRowAfter')},
  {id:'table-col-before',label:'在左侧插入列',onClick:cmd('addColumnBefore')},
  {id:'table-col-after',label:'在右侧插入列',onClick:cmd('addColumnAfter')},
  {id:'table-merge',label:'合并单元格',isDisabled:!editor.can().mergeCells(),onClick:cmd('mergeCells')},
  {id:'table-split',label:'拆分单元格',isDisabled:!editor.can().splitCell(),onClick:cmd('splitCell')},
  {id:'table-row-delete',label:'删除行',onClick:cmd('deleteRow')},
  {id:'table-col-delete',label:'删除列',onClick:cmd('deleteColumn')}
 ];
}
export function codeContextItems(editor:Editor,code:string,pos:number,notify:Feedback):DropdownMenuItemData[]{
 const languages=['plaintext','javascript','typescript','python','bash','json','html','css','markdown','mermaid'];
 return [
  {id:'code-copy',label:'复制代码',onClick:()=>{void navigator.clipboard.writeText(code)
   .catch(()=>notify('无法复制代码，请使用 Ctrl+C。'));}},
  {id:'code-language',label:'切换语言',items:languages.map(language=>({
   id:'code-language-'+language,label:language,
   onClick:()=>editor.chain().focus().setTextSelection(pos).updateAttributes('codeBlock',{language:language==='plaintext'?null:language}).run()
  }))}
 ];
}
