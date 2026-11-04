export type KnowledgeNode={
 id:string;name:string;kind:string;status:string;folderId:string|null;
 folderName:string|null;updatedAt:string;revision:number
};
export type KnowledgeEdge={
 id:string;sourceId:string;targetId:string;
 type:'explicit'|'semantic'|'folder';relation:string;
 score?:number;snippet?:string;support?:number
};
export type SemanticState='ready'|'indexing'|'unavailable'|'archived'|'disabled';
export type RecordRelationship=KnowledgeEdge & {
 direction:'outgoing'|'incoming';other:KnowledgeNode
};
export type SemanticSuggestion=KnowledgeEdge & {other:KnowledgeNode};
export type RelationsResponse={
 source:KnowledgeNode;links:RecordRelationship[];
 suggestions:SemanticSuggestion[];semanticStatus:SemanticState;indexingMayLag:boolean
};
export type GraphResponse={
 nodes:KnowledgeNode[];edges:KnowledgeEdge[];focusId:string|null;
 semanticStatus:SemanticState;limit:number;scope:'recent'|'local'
};
export const relationLabels:Record<string,string>={
 related:'相关',references:'引用',depends_on:'依赖',continues:'续篇',supports:'支持',contradicts:'不同观点'
};
export function relationLabel(value:string){
 return relationLabels[value]??value.replace(/_/g,' ');
}
export function semanticMessage(status:SemanticState):string{
 switch(status){
  case 'ready':return '根据现有文本块向量发现的候选，尚未建立正式链接。';
  case 'indexing':return '该记录尚未完成向量索引，可稍后再查看语义关联。';
  case 'unavailable':return '语义索引暂不可用；已确认的关系仍可正常使用。';
  case 'archived':return '归档记录不会参与语义索引，但已建立的关联仍会保留。';
  default:return '语义关联已关闭。';
 }
}
