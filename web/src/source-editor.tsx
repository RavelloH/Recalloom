import React,{useMemo} from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {markdown} from '@codemirror/lang-markdown';
export default function SourceEditor({value,onChange,dark}:{value:string;onChange:(v:string)=>void;dark:boolean}){const extensions=useMemo(()=>[markdown()],[]);return <CodeMirror value={value} height="min(64vh, 760px)" extensions={extensions} theme={dark?'dark':'light'} basicSetup={{foldGutter:true,highlightActiveLine:true}} onChange={onChange} aria-label="Markdown 源码编辑器"/>;}
