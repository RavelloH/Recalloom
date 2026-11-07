/** Stable anchor slugs shared by preview and visual mode.
 * The user-content prefix matches rehype-sanitize's DOM-clobbering protection. */
export const slugHeading=(value:string)=>value.trim().toLowerCase()
 .replace(/[^\p{L}\p{N}\-\s]/gu,'').replace(/\s+/g,'-');
export const headingAnchor=(value:string)=>'user-content-'+slugHeading(value);
