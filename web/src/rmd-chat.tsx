import React,{type ReactNode} from 'react';
import './rmd-chat.css';
import {Avatar} from '@astryxdesign/core/Avatar';
import {ChatMessage,ChatMessageBubble,ChatMessageList} from '@astryxdesign/core/Chat';

export type RmdChatSender='user'|'assistant'|'system';

/**
 * RMD chat is a static Markdown transcript, not a live ChatLayout/composer.
 * Keep Astryx in charge of sender alignment, bubble surface, identity and
 * accessible log semantics. Explicit density is important in Tiptap: sibling
 * NodeViews use separate React roots and cannot inherit ChatListContext.
 */
export function RmdChatTranscript({children,title,titleNode}:{children:ReactNode;title?:string;titleNode?:ReactNode}){
 return <section className="rk-chat-embed" aria-label={title?.trim()||'对话记录'}>
  {title?.trim()&&<div className="rk-chat-embed-title">{titleNode??title}</div>}
  <ChatMessageList className="rk-chat-transcript" density="compact" align="top">
   {children}
  </ChatMessageList>
 </section>;
}

export function RmdChatMessage({
 sender,name,avatarName,children,
}:{
 sender:RmdChatSender;
 name:ReactNode;
 avatarName:string;
 children:ReactNode;
}){
 return <ChatMessage
  sender={sender}
  density="compact"
  className="rk-chat-row"
  avatar={sender==='system'?undefined:<Avatar name={avatarName} size="sm" tooltip={false}/>}>
  <ChatMessageBubble
   className="rk-chat-bubble"
   name={name}
   variant={sender==='user'?'filled':'ghost'}>
   {children}
  </ChatMessageBubble>
 </ChatMessage>;
}
