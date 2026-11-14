import React,{type ReactNode} from 'react';
import {ToastViewport,type ToastContentRenderProps} from '@astryxdesign/core/Toast';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '../icon';

/** A local viewport retains the contextual message near the menu invocation. */
export function EditorContextFeedback({point,children}:{point:{x:number;y:number};children:ReactNode}){
 const width=typeof window==='undefined'?1024:window.innerWidth;
 const height=typeof window==='undefined'?768:window.innerHeight;
 // ToastViewport supplies its standard 16px safe gutter. Compensate for it
 // while keeping the previous clamping when the pointer is near an edge.
 const start=Math.max(0,Math.min(point.x,width-300)-16);
 const top=Math.max(0,Math.min(point.y+18,height-72)-16);
 return <ToastViewport position="topStart" maxVisible={1} inset={{top,start}}>{children}</ToastViewport>;
}

export function editorContextToastContent({body,dismiss}:ToastContentRenderProps){
 return <div className="rk-editor-context-toast">
  <span className="rk-editor-context-toast-message">{body}</span>
  <IconButton label="关闭编辑器提示" className="rk-editor-context-toast-dismiss" size="sm" variant="ghost"
   icon={<Icon name="x" size="sm"/>} onClick={dismiss}/>
 </div>;
}
