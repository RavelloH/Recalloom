import {HELP_META,HELP_PAGES,HELP_RMD_COMPONENTS,HELP_RMD_NODES} from './catalog.generated.js';

export type HelpTopic=keyof typeof HELP_PAGES;
export const HELP_TOPICS=Object.keys(HELP_PAGES) as HelpTopic[];
export const RMD_COMPONENT_NAMES=Object.keys(HELP_RMD_COMPONENTS);
export const RMD_NODE_NAMES=Object.keys(HELP_RMD_NODES);
export type RmdHelpSelector={component?:string;node?:string;kind?:'inline'|'block'|'leaf'};
const INDEX_URI='recalloom://help/index';
const indexContent=[
 '# Recalloom 帮助目录','',
 'Recalloom 支持 CommonMark/GFM、KaTeX 数学公式、RMD 组件、WikiLink、只读内容嵌入，以及独立归档与安全删除。',
 '需要完整语法时阅读 markdown；需要单个组件时调用 get_help({topic:"markdown",component:"badge"})；',
 '需要指定块属性时调用 get_help({topic:"markdown",node:"image"})。markdown 的正文还自动附有全部组件和属性的规范参考。',
 '',
 ...HELP_TOPICS.map(topic=>'- **'+topic+'** — '+HELP_PAGES[topic].title+'：'+HELP_PAGES[topic].summary),
 '',
 '调用 get_help({topic:"math"}) 或读取 MCP Resource recalloom://help/math 获取完整说明。',
 '未指定 topic 的 get_help 返回本目录。',
 '支持 '+RMD_COMPONENT_NAMES.length+' 个组件名称、'+RMD_NODE_NAMES.length+' 类块属性目标。',
 '',
 '帮助版本：'+HELP_META.helpVersion+'（格式版本：'+HELP_META.schemaVersion+'）',
 '内容 SHA-256：'+HELP_META.contentHash
].join('\n');

export type HelpDocument={
 topic:string;title:string;summary:string;uri:string;content:string;
 schemaVersion:number;helpVersion:string;contentHash:string
};
export function getHelp(topic?:HelpTopic,selector:RmdHelpSelector={}):HelpDocument{
 const {component,node,kind}=selector;
 if(component||node||kind){
  if(topic&&topic!=='markdown')throw Error('RMD component/node help requires topic markdown');
  if(!!component===!!node)throw Error('Exactly one of component or node is required');
  if(node&&kind)throw Error('kind is only valid for component help');
  if(component){
   const page=HELP_RMD_COMPONENTS[component as keyof typeof HELP_RMD_COMPONENTS];
   if(!page)throw Error('Unknown RMD component: '+component);
   const content=kind?page.formContent[kind as keyof typeof page.formContent]:page.content;
   if(!content)throw Error('Unsupported RMD component form: '+kind);
   return {...HELP_META,topic:'markdown',title:page.title,summary:'RMD '+component+' 的合法语法、参数和限制',
    uri:'recalloom://help/markdown',content};
  }
  const page=HELP_RMD_NODES[node! as keyof typeof HELP_RMD_NODES];
  if(!page)throw Error('Unknown RMD node: '+node);
  return {...HELP_META,topic:'markdown',title:page.title,summary:'RMD @ attrs '+node+' 可使用的属性',
   uri:'recalloom://help/markdown',content:page.content};
 }
 const page=topic?{topic,...HELP_PAGES[topic]}:{
  topic:'index',title:'帮助主题索引',summary:'可用帮助主题及读取方式',uri:INDEX_URI,content:indexContent
 };
 return {...page,...HELP_META};
}
export function listHelpResources():HelpDocument[]{
 return [getHelp(),...HELP_TOPICS.map(topic=>getHelp(topic))];
}
