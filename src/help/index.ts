import {HELP_PAGES} from './catalog.generated.js';

export type HelpTopic=keyof typeof HELP_PAGES;
export const HELP_TOPICS=Object.keys(HELP_PAGES) as HelpTopic[];

const INDEX_URI='recalloom://help/index';
const indexContent=[
 '# Recalloom 帮助目录',
 '',
 'Recalloom 支持 CommonMark/GFM、KaTeX 数学公式、mark 高亮、WikiLink 与只读内容嵌入。',
 '优先通过当前工具描述调用常规操作；需要详细语法或完整操作规则时读取对应主题。',
 '',
 ...HELP_TOPICS.map(topic=>'- **'+topic+'** — '+HELP_PAGES[topic].title+'：'+HELP_PAGES[topic].summary),
 '',
 '调用 get_help({topic: "math"}) 或读取 MCP Resource recalloom://help/math 获取完整说明。',
 '未指定 topic 的 get_help 返回本目录。'
].join('\n');

export type HelpDocument={topic:string;title:string;summary:string;uri:string;content:string};

export function getHelp(topic?:HelpTopic):HelpDocument{
 if(!topic)return {topic:'index',title:'帮助主题索引',summary:'可用帮助主题及读取方式',uri:INDEX_URI,content:indexContent};
 const page=HELP_PAGES[topic];
 return {topic,...page};
}

export function listHelpResources():HelpDocument[]{
 return [getHelp(),...HELP_TOPICS.map(topic=>getHelp(topic))];
}