/** Stable anchor slugs shared by preview, Wiki sections, and visual mode.
 * Explicit IDs are attached only by the RMD @ attrs parser.
 * The user-content prefix prevents DOM clobbering in rehype-sanitize.
 */
export const slugHeading=(value:string)=>value.trim().toLowerCase()
 .replace(/[^\p{L}\p{N}\-\s]/gu,'').replace(/\s+/g,'-');
export const headingAnchor=(value:string)=>'user-content-'+slugHeading(value);
