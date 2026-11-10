/** Transient editor drag geometry shared with the out-of-flow sketch layer.
 * DOM elements are passed only within the same editor surface, never stored
 * in the document or exposed to user-authored Markdown. */
export const SKETCH_DRAG_PREVIEW_EVENT='rk-sketch-drag-preview';

export type SketchDragPreview={
 source:HTMLElement;
 shifts:readonly {element:HTMLElement;offsetY:number}[];
};
