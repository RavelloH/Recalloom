export type SlashState={from:number;to:number;query:string;index:number;placement:'above'|'below';offset:number;left:number;insertOnly?:boolean};
export type WikiState=SlashState&{kind:'link'|'embed'};
export type InlinePopupItem={id:string;label:string;description?:string;disabled?:boolean;active?:boolean;run:()=>void};
export type InlinePopup={label:string;left:number;top:number;items:InlinePopupItem[]};
export type VisualEditorHandle={flushEditedMarkdown:()=>string|null};
