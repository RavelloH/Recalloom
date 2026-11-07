export const richContainerKinds=new Set(['note','info','tip','success','warning','danger','example','question','details','chat','message','tabs','tab']);
export const richInlineKinds=new Set(['badge','abbr','tip','highlight']);
const defaultTitles:Record<string,string>={
 note:'备注',info:'信息',tip:'提示',success:'成功',warning:'注意',danger:'危险',
 example:'示例',question:'问题',details:'详细内容',chat:'对话记录',message:'发言',tabs:'标签页',tab:'选项卡'
};
export const richTitle=(kind:string,title?:string)=>title||defaultTitles[kind]||kind;

export const richLeafKinds=new Set(['link-card']);
