import React,{useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Button} from '@astryxdesign/core/Button';
import {IconEye,IconEyeOff} from '@tabler/icons-react';
import {richTitle} from './tiptap/rich-schema';

/** Same readable card and answer-toggle placement as VisualEditor.
 * Back content stays mounted and hidden until explicitly revealed;
 * reading never writes a revision. */
export default function FlashcardPreview({children,title}:{children:React.ReactNode;title?:string}){
 const [open,setOpen]=useState(false);
 return <Card variant="default" padding={3} className="rk-flashcard rk-flashcard-read" data-rk-answer-open={String(open)}>
  <div className="rk-flashcard-heading rk-flashcard-read-heading">
   <span>{richTitle('flashcard',title)}</span>
   <Button variant="ghost" label={open?'收起答案':'显示答案'}
    icon={open?<IconEyeOff size="1.125em" aria-hidden="true"/>:<IconEye size="1.125em" aria-hidden="true"/>}
    aria-expanded={open} onClick={()=>setOpen(value=>!value)}/>
  </div>
  <div className="rk-flashcard-body">{children}</div>
 </Card>;
}
