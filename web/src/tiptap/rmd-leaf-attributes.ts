/** Validation for atom-like RMD blocks. Pure helpers shared by UI/tests. */
import {normalizedLinkUrl} from '../link-metadata-client';
import {parseWikiTarget} from '../../../src/wiki-syntax';

export type LeafEditKind='richLinkCard'|'wikiEmbed';
export function normalizeLeafFields(kind:LeafEditKind,field:'url'|'title'|'target',raw:string):
 {ok:true;attrs:Record<string,string|null>}|{ok:false;error:string}{
 const input=raw.trim();
 if(kind==='richLinkCard'){
  if(field==='url'){
   if(!normalizedLinkUrl(input)||/[\s|]/.test(input))return {ok:false,error:'必须是有效的 HTTP(S) 公开页面地址，最长 2048 字符，不能包含 |'};
   return {ok:true,attrs:{url:input}};
  }
  if(field==='title'){
   if(/[\r\n|]/.test(raw)||raw.length>240)return {ok:false,error:'标题不得换行、包含 | 或超过 240 字符'};
   return {ok:true,attrs:{title:input}};
  }
 }
 if(kind==='wikiEmbed'&&field==='target'){
  const parsed=/[|\r\n]/.test(input)?null:parseWikiTarget(input,false);
  if(!parsed)return {ok:false,error:'必须使用文档 UUID（id:...）或绝对路径（/文件名.md），可附加 #anchor-id，不能包含 |'};
  return {ok:true,attrs:{target:parsed.target,anchor:parsed.anchor}};
 }
 return {ok:false,error:'当前块不支持该字段'};
}