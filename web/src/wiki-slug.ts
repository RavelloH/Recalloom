/** Stable anchor slugs shared by preview and visual mode.
 * The user-content prefix matches rehype-sanitize's DOM-clobbering protection. */
export const slugHeading=(value:string)=>value.trim().toLowerCase()
 .replace(/[^\p{L}\p{N}\-\s]/gu,'').replace(/\s+/g,'-');
export const headingAnchor=(value:string)=>'user-content-'+slugHeading(value);

/** Stable explicit heading ID, strictly bounded for HTML and Wiki links. */
export function explicitHeadingAnchor(text:string):{body:string;id:string}|null{
 const match=/(?:^|\s)\{#([a-z][a-z0-9-]{0,79})\}\s*$/i.exec(text);
 if(!match)return null;
 return {body:text.slice(0,match.index).trimEnd(),id:match[1]!.toLowerCase()};
}

/** Obsidian-compatible paragraph ^block-id, restricted to safe stable IDs. */
export function explicitBlockAnchor(text:string):{body:string;id:string}|null{
 const match=/(?:^|\s)\^([a-z][a-z0-9-]{0,79})\s*$/i.exec(text);
 if(!match)return null;
 return {body:text.slice(0,match.index).trimEnd(),id:match[1]!.toLowerCase()};
}
