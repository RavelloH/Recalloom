import React,{useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {EditorView} from '@codemirror/view';
import type {Text} from '@codemirror/state';
import {autocompletion} from '@codemirror/autocomplete';
import {rmdCompletionSource} from './rmd-completion';
import {tags as t} from '@lezer/highlight';
import {activeDocumentHeading,documentOutline,parseDocumentHeadings,type DocumentOutline} from './document-outline';

/* Obsidian-style source mode: the Markdown stays literal, but it reads like
   the document — same column, typeface and rhythm, soft-wrapped, no gutters.
   Syntax marks recede so the words stay in front. Colours come from theme
   variables, so light and dark follow the app without a second theme. */
const markdownHighlight=HighlightStyle.define([
 {tag:t.heading1,fontSize:'1.6em',fontWeight:'700',letterSpacing:'-.02em'},
 {tag:t.heading2,fontSize:'1.35em',fontWeight:'680'},
 {tag:t.heading3,fontSize:'1.15em',fontWeight:'660'},
 {tag:[t.heading4,t.heading5,t.heading6],fontWeight:'650'},
 {tag:t.strong,fontWeight:'700'},
 {tag:t.emphasis,fontStyle:'italic'},
 {tag:t.strikethrough,textDecoration:'line-through'},
 {tag:[t.processingInstruction,t.meta,t.contentSeparator],color:'var(--rk-ink-faint)'},
 {tag:t.list,color:'var(--rk-ink-faint)'},
 {tag:t.quote,color:'var(--rk-ink-soft)'},
 {tag:t.link,color:'var(--color-text-link, #2269b5)'},
 {tag:t.url,color:'var(--rk-ink-faint)',textDecoration:'underline',textDecorationColor:'color-mix(in srgb, currentColor 40%, transparent)'},
 {tag:t.monospace,fontFamily:'var(--rk-font-mono)',fontSize:'.9em',color:'var(--rk-code-ink)'},
 {tag:[t.labelName,t.string],color:'var(--rk-ink-soft)'},
 {tag:t.comment,color:'var(--rk-ink-faint)',fontStyle:'italic'}
]);
const documentTheme=EditorView.theme({
 '&':{color:'var(--color-text-primary)',backgroundColor:'transparent',fontSize:'16px'},
 '&.cm-focused':{outline:'none'},
 '.cm-scroller':{fontFamily:'inherit',lineHeight:'1.82',overflow:'visible'},
 '.cm-content':{padding:'18px 0 120px',caretColor:'var(--color-text-primary)',maxWidth:'100%'},
 '.cm-line':{padding:'0'},
 '.cm-cursor, .cm-dropCursor':{borderLeftColor:'var(--color-text-primary)',borderLeftWidth:'1.5px'},
 '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':{backgroundColor:'var(--rk-selection) !important'},
 '.cm-activeLine':{backgroundColor:'transparent'},
 '.cm-placeholder':{color:'var(--rk-ink-faint)'},
 '.cm-panels':{backgroundColor:'var(--rk-popover)',color:'inherit'},
 '.cm-searchMatch':{backgroundColor:'color-mix(in srgb, #f5d870 55%, transparent)'},
 '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#f5d870'}
});

export type SourceEditorHandle={jumpToHeading:(key:string)=>boolean};
export default React.forwardRef<SourceEditorHandle,{value:string;onChange:(v:string)=>void;focusLine?:number;focusToken?:number;outlineOpen?:boolean;onOutlineChange?:(outline:DocumentOutline)=>void}>(function SourceEditor({value,onChange,focusLine,focusToken,outlineOpen=false,onOutlineChange},ref){
 const outlineOpenRef=useRef(outlineOpen),outlineCallbackRef=useRef(onOutlineChange);
 outlineOpenRef.current=outlineOpen;outlineCallbackRef.current=onOutlineChange;
 const outlineCache=useRef<{doc:unknown;headings:ReturnType<typeof parseDocumentHeadings>}|null>(null);
 const outlineFor=(doc:Text,position:number)=>{
  let cached=outlineCache.current;
  if(cached?.doc!==doc){cached={doc,headings:parseDocumentHeadings(doc.toString())};outlineCache.current=cached;}
  return documentOutline(cached.headings,activeDocumentHeading(cached.headings,doc.lineAt(position).number-1));
 };
 const extensions=useMemo(()=>[
  markdown({base:markdownLanguage}),syntaxHighlighting(markdownHighlight),documentTheme,
  EditorView.lineWrapping,
  autocompletion({override:[rmdCompletionSource],activateOnTyping:true,defaultKeymap:true}),
  EditorView.updateListener.of(update=>{
   if(!outlineOpenRef.current||(!update.docChanged&&!update.selectionSet))return;
   outlineCallbackRef.current?.(outlineFor(update.state.doc,update.state.selection.main.head));
  }),
  EditorView.contentAttributes.of({spellcheck:'false','aria-label':'Markdown 源码编辑器'})
 ],[]);
 const view=useRef<EditorView|null>(null);
 const jump=(v:EditorView|null)=>{
  if(!v||!focusLine)return;
  const line=v.state.doc.line(Math.min(Math.max(focusLine,1),v.state.doc.lines));
  v.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'center'})});
  v.focus();
 };
 React.useImperativeHandle(ref,()=>({jumpToHeading:(key:string)=>{
  const lineNumber=Number(/^markdown:(\d+)$/.exec(key)?.[1]);
  const v=view.current;
  if(!v||!Number.isInteger(lineNumber)||lineNumber<0||lineNumber>=v.state.doc.lines)return false;
  const line=v.state.doc.line(lineNumber+1);
  v.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'center'})});
  v.focus();
  return true;
 }}),[]);
 useEffect(()=>{jump(view.current);},[focusLine,focusToken]);
 useEffect(()=>{
  if(!outlineOpen)return;
  const v=view.current;if(!v)return;
  outlineCallbackRef.current?.(outlineFor(v.state.doc,v.state.selection.main.head));
 },[outlineOpen]);
 useLayoutEffect(()=>{const v=view.current;if(!v)return;const current=v.state.doc.toString();if(current!==value)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:value}});},[value]);
 return <div className="source-editor"><CodeMirror value={value} extensions={extensions} theme="none"
  basicSetup={{lineNumbers:false,foldGutter:false,highlightActiveLine:false,highlightActiveLineGutter:false,highlightSelectionMatches:false,autocompletion:false,searchKeymap:true}}
  onCreateEditor={v=>{view.current=v;jump(v);if(outlineOpenRef.current)outlineCallbackRef.current?.(outlineFor(v.state.doc,v.state.selection.main.head));}} onChange={onChange}/></div>;
});
