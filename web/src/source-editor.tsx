import React,{useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {markdown} from '@codemirror/lang-markdown';
import {EditorView} from '@codemirror/view';

export default function SourceEditor({value,onChange,dark,focusLine,focusToken}:{value:string;onChange:(v:string)=>void;dark:boolean;focusLine?:number;focusToken?:number}){
 const extensions=useMemo(()=>[markdown()],[]);
 const view=useRef<EditorView|null>(null);
 const jump=(v:EditorView|null)=>{
  if(!v||!focusLine)return;
  const line=v.state.doc.line(Math.min(Math.max(focusLine,1),v.state.doc.lines));
  v.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'center'})});
  v.focus();
 };
 useEffect(()=>{jump(view.current);},[focusLine,focusToken]);
 useLayoutEffect(()=>{const v=view.current;if(!v)return;const current=v.state.doc.toString();if(current!==value)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:value}});},[value]);
 return <CodeMirror value={value} height="min(64vh, 760px)" extensions={extensions} theme={dark?'dark':'light'} basicSetup={{foldGutter:true,highlightActiveLine:true}} onCreateEditor={v=>{view.current=v;jump(v);}} onChange={onChange} aria-label="Markdown 源码编辑器"/>;
}
