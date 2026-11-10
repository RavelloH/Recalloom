/** Editable rich-container attributes derive from the canonical RMD block registry.
 * 'id' is intentionally not advertised here: RichContainer currently does not
 * round-trip block id through Tiptap. Keep it out of the UI until that is fixed.
 */
import {getRmdSchema,isValidRmdValue,RMD_COLORS,type RmdValueType} from '../rmd-schema';

export const CHAT_SENDERS=['assistant','user','system'] as const;
export type RichContainerField='title'|'sender'|'color'|'stroke'|'padding'|'roughness'|'opacity';
export function richContainerFields(kind:string):RichContainerField[]{
 const schema=getRmdSchema('block',kind);
 if(!schema)return [];
 const fields:RichContainerField[]=[];
 if(schema.main!=='forbidden')fields.push('title');
 for(const name of ['sender','color','stroke','padding','roughness','opacity'] as const)
  if(name in schema.attributes)fields.push(name);
 return fields;
}
export function normalizeRichContainerField(kind:string,field:RichContainerField,raw:string):
 {ok:true;value:string|number|null}|{ok:false;error:string}{
 const schema=getRmdSchema('block',kind);
 if(!schema||!richContainerFields(kind).includes(field))
  return {ok:false,error:'当前 RMD 容器不支持此属性'};
 if(field==='title'){
  const value=raw.replace(/[\r\n]/g,' ');
  return value.length>180?{ok:false,error:'标题不能超过 180 个字符'}:{ok:true,value};
 }
 const clean=raw.trim();
 if(field==='sender')
  return (CHAT_SENDERS as readonly string[]).includes(clean)
   ?{ok:true,value:clean}:{ok:false,error:'消息身份只能是 assistant、user 或 system'};
 if(!clean)return {ok:true,value:null};
 if(field==='color')
  return RMD_COLORS.includes(clean)
   ?{ok:true,value:clean}:{ok:false,error:'颜色必须是九种预设颜色之一'};
 const type=schema.attributes[field] as RmdValueType|undefined;
 if(!type?.startsWith('sketch-')||!isValidRmdValue(type,clean))
  return {ok:false,error:({
   stroke:'笔画宽度须在 0.5–6，最多两位小数',
   padding:'边距须在 0–24，最多两位小数',
   roughness:'手绘粗糙度须在 0–3，最多两位小数',
   opacity:'透明度须在 0.1–0.85，最多两位小数'
  } as Record<string,string>)[field]??'无效的手绘属性'};
 return {ok:true,value:Number(clean)};
}