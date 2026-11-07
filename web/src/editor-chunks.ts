import {preloadable} from './lazy';

/* Editor chunks are split from the shell; route loaders warm them alongside
   the record so a document opens fully formed instead of in stages. */
export const RecordEditorChunk=preloadable(()=>import('./record-editor').then(module=>({default:module.RecordEditor})));
export const VisualEditorChunk=preloadable(()=>import('./visual-editor'));
export const SourceEditorChunk=preloadable(()=>import('./source-editor'));
export type EditorMode='visual'|'source';
export const preloadEditor=(mode:EditorMode='visual')=>Promise.all([
 RecordEditorChunk.preload(),
 (mode==='source'?SourceEditorChunk:VisualEditorChunk).preload()
]);
