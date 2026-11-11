export const tableToolbarOffset=(cell:Element,surface:Element,compact:boolean)=>{
 const table=cell.closest('.tableWrapper')??cell;
 const box=table.getBoundingClientRect(),top=surface.getBoundingClientRect().top;
 // No room above (a table opening the document): sit just below it instead.
 return box.top-top-54>=(compact?60:8)?box.top-top-54:box.bottom-top+8;
};

/** Shared completion positioning constants. */
export const SLASH_MENU_WIDTH=300;
export const SLASH_MENU_SPACE=280;
