import Underline from '@tiptap/extension-underline';

/** HTML/paste representation only. RMD's serializer emits <u> explicitly. */
export const CustomUnderline=Underline.extend({
 name:'underline',
 priority:2000
});
