export type SlashState={from:number;to:number;query:string;index:number;placement:'above'|'below';offset:number;left:number;insertOnly?:boolean};
export type WikiState=SlashState&{kind:'link'|'embed'};
import type {FormatHoverKind} from '../tiptap/format-hover-preview';
import type {DocumentOutline} from '../document-outline';
export type InlinePopupItem={id:string;label:string;description?:string;disabled?:boolean;active?:boolean;preview?:FormatHoverKind;run:()=>void};
export type VisualEditorHandle={flushEditedMarkdown:()=>string|null;getOutline:()=>DocumentOutline|null;jumpToHeading:(key:string)=>boolean};
