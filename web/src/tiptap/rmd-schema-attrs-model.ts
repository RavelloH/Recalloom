/** Pure Schema-driven model for the six RMD @ attrs node families.
 * This module deliberately does not import React so parsers, editor actions
 * and tests can share the same validation without rendering components.
 */
import {RMD_REGISTRY,isRmdId,isValidRmdValue,type RmdValueType} from '../rmd-schema';

export type RmdAttrDefinition={node:string;label:string;attributes:Record<string,RmdValueType>;fieldLabels:Record<string,string>;editorIdPrefix?:string};
export const rmdAttrNodeMapping:Readonly<Record<string,{node:string;id:string}>>={
 heading:{node:'heading',id:'id'},paragraph:{node:'paragraph',id:'blockId'},
 blockMath:{node:'math',id:'equationId'},table:{node:'table',id:'tableId'},
 codeBlock:{node:'code',id:'id'},image:{node:'image',id:'figureId'}
};
export const isRmdAttrsEditable=(type:string)=>Boolean(rmdAttrNodeMapping[type]&&
 RMD_REGISTRY.nodes.some(n=>n.node===rmdAttrNodeMapping[type]!.node));
export const pmAttrKey=(field:string,mapping:{id:string})=>
 field==='id'?mapping.id:field==='file'?'filename':field;
export function rmdAttributeDefinition(type:string):RmdAttrDefinition|null{
 const mapping=rmdAttrNodeMapping[type];if(!mapping)return null;
 return (RMD_REGISTRY.nodes.find(x=>x.node===mapping.node) as RmdAttrDefinition|undefined)??null;
}
export function normalizeRmdAttribute(type:string,field:string,raw:string):
 {ok:true;value:string|number|boolean|null}|{ok:false;error:string}{
 const definition=rmdAttributeDefinition(type);
 if(!definition||!(field in definition.attributes))return {ok:false,error:'不支持的 Markdown 属性'};
 const valueType=definition.attributes[field]!,input=raw.trim();
 const label=definition.fieldLabels[field]??field;
 if(field==='id'){
  const normalized=input.toLowerCase();
  if(normalized&&!isRmdId(normalized))
   return {ok:false,error:'ID 必须以英文字母开头，只能使用字母、数字、连字符，最长 '+RMD_REGISTRY.constraints.idMaximumLength+' 字符'};
  const prefix=definition.editorIdPrefix??'';
  if(normalized&&prefix&&!normalized.startsWith(prefix))
   return {ok:false,error:'当前类型的 ID 必须以 '+prefix+' 开头'};
  return {ok:true,value:normalized||null};
 }
 if(valueType==='boolean'){
  if(input!=='true'&&input!=='false')return {ok:false,error:label+'必须为 true 或 false'};
  return {ok:true,value:input==='true'};
 }
 if(valueType==='integer'){
  if(input&&!isValidRmdValue('integer',input))
   return {ok:false,error:label+'必须为 '+RMD_REGISTRY.constraints.integerMinimum+'–'+RMD_REGISTRY.constraints.integerMaximum+' 的整数'};
  return {ok:true,value:input?Number(input):null};
 }
 if(input.length>RMD_REGISTRY.constraints.stringEditorMaximumLength)
  return {ok:false,error:label+'不能超过 '+RMD_REGISTRY.constraints.stringEditorMaximumLength+' 个字符'};
 if(/[\r\n]/.test(raw))return {ok:false,error:label+'不能包含换行符'};
 return {ok:true,value:input};
}