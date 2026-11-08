export const richContainerKinds=new Set(['note','info','tip','success','warning','danger','example','question','details','chat','message','tabs','tab','flashcard','front','back','glossary','definition','mark','highlight','comment']);
export const richInlineKinds=new Set(['badge','abbr','tooltip','highlight','kbd','cloze']);
const defaultTitles:Record<string,string>={
 note:'备注',info:'信息',tip:'提示',success:'成功',warning:'注意',danger:'危险',
 example:'示例',question:'问题',details:'详细内容',chat:'对话记录',message:'发言',tabs:'标签页',tab:'选项卡',flashcard:'学习闪卡',front:'问题',back:'答案',glossary:'术语表',definition:'术语',mark:'标记',highlight:'强调',comment:'注释'
};
export const richTitle=(kind:string,title?:string)=>title||defaultTitles[kind]||kind;

export const richLeafKinds=new Set(['link-card']);
const requiredParents:Record<string,string>={tab:'tabs',message:'chat',front:'flashcard',back:'flashcard',definition:'glossary'};
/** Nested child directives are not standalone callouts. */
export function validContainerParent(kind:string,parentKind?:string):boolean{
 return !(kind in requiredParents)||requiredParents[kind]===parentKind;
}
