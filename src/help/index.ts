import {MCP_HELP_META,MCP_HELP_INDEX,MCP_HELP_PAGES,MCP_RMD_COMPONENTS,MCP_RMD_NODES} from './mcp-catalog.generated.js';

export type HelpTopic=keyof typeof MCP_HELP_PAGES;
export const HELP_TOPICS=Object.keys(MCP_HELP_PAGES) as HelpTopic[];
export const RMD_COMPONENT_NAMES=Object.keys(MCP_RMD_COMPONENTS);
export const RMD_NODE_NAMES=Object.keys(MCP_RMD_NODES);
export type RmdHelpSelector={component?:string;node?:string;kind?:'inline'|'block'|'leaf'};

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
   const page=MCP_RMD_COMPONENTS[component as keyof typeof MCP_RMD_COMPONENTS];
   if(!page)throw Error('Unknown RMD component: '+component);
   const content=kind?page[kind as keyof typeof page]:Object.values(page).join('\n\n');
   if(!content)throw Error('Unsupported RMD component form: '+kind);
   return {...MCP_HELP_META,topic:'markdown',title:'RMD '+component,summary:'Component syntax and parameters',
    uri:'recalloom://help/markdown',content:'# RMD '+component+'\n\n'+content};
  }
  const content=MCP_RMD_NODES[node! as keyof typeof MCP_RMD_NODES];
  if(!content)throw Error('Unknown RMD node: '+node);
  return {...MCP_HELP_META,topic:'markdown',title:'RMD @ attrs: '+node,summary:'Supported block attributes',
   uri:'recalloom://help/markdown',content};
 }
 const page=topic?{...MCP_HELP_PAGES[topic],summary:MCP_HELP_PAGES[topic].title}:{
  title:'Recalloom help',summary:'Available help topics',content:MCP_HELP_INDEX
 };
 return {...page,...MCP_HELP_META,topic:topic??'index',uri:'recalloom://help/'+(topic??'index')};
}
export function listHelpResources():HelpDocument[]{
 return [getHelp(),...HELP_TOPICS.map(topic=>getHelp(topic))];
}
