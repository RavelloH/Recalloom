/** Image URL security is independent from Markdown syntax parsing.
 * Presentation properties are defined by the RMD @ attrs schema.
 */
export function safeFigureImageSrc(src:string):boolean{
 const value=src.trim();
 return value.length>0&&value.length<=2048&&
  !/[\u0000-\u001f<>]/.test(value)&&
  (/^https?:\/\//i.test(value)||/^(?!\/\/)(?![a-z][a-z0-9+.-]*:)[^\s<>"']+$/i.test(value));
}
