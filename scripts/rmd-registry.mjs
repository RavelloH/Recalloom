import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const REGISTRY_PATH=resolve(import.meta.dirname,'../src/rmd/registry.json');
const names=new Set(['inline','block','leaf']);
const values=new Set(['string','boolean','integer','color','variant','id','sketch-stroke','sketch-padding','sketch-roughness','sketch-opacity']);
const mains=new Set(['required','optional','forbidden']);
const key=/^[a-z][a-z0-9-]*$/;

export function readRegistry(){
 const r=JSON.parse(readFileSync(REGISTRY_PATH,'utf8'));
 if(!Array.isArray(r.components)||!Array.isArray(r.nodes)||!Array.isArray(r.colors)||!Array.isArray(r.variants))throw Error('Invalid RMD registry');
 const known=new Set(),nodeNames=new Set();
 for(const c of r.components){
  if(!key.test(c.name)||!names.has(c.type)||!mains.has(c.main)||!Array.isArray(c.positions)||!c.attributes||typeof c.summary!=='string'||!c.example)throw Error('Invalid component '+c.name);
  const id=c.type+':'+c.name;
  if(known.has(id))throw Error('Duplicate component '+id);
  known.add(id);
  for(const [k,v] of Object.entries(c.attributes))if(!key.test(k)||!values.has(v))throw Error('Invalid attribute '+id+':'+k);
  if(c.positions.some(p=>!Object.hasOwn(c.attributes,p)))throw Error('Missing positional property '+id);
  if(c.orderedChildren?.some(p=>!c.children?.includes(p)))throw Error('Missing ordered child '+id);
  if(c.requiredAttributes?.some(p=>!Object.hasOwn(c.attributes,p)))throw Error('Missing required property '+id);
  if(c.defaults)for(const k of Object.keys(c.defaults))if(!Object.hasOwn(c.attributes,k))throw Error('Invalid default '+id);
 }
 for(const c of r.components){
  for(const parent of c.allowedParents??[])if(!known.has('block:'+parent))throw Error('Undeclared parent '+parent);
  for(const child of c.children??[])if(!known.has('block:'+child))throw Error('Undeclared child '+child);
 }
 for(const n of r.nodes){
  if(!key.test(n.node)||nodeNames.has(n.node)||typeof n.summary!=='string'||typeof n.example!=='string')throw Error('Invalid node '+n.node);
  nodeNames.add(n.node);
  if(n.editorIdPrefix&&(typeof n.editorIdPrefix!=='string'||!/^[a-z]+-$/.test(n.editorIdPrefix)))throw Error('Invalid editor ID prefix '+n.node);
  if(n.editorIdPrefix&&!Object.hasOwn(n.attributes,'id'))throw Error('Editor prefix requires id '+n.node);
  for(const [k,v] of Object.entries(n.attributes))if(!key.test(k)||!values.has(v))throw Error('Invalid node attribute '+n.node+':'+k);
 }
 if(!r.components.length||!r.nodes.length)throw Error('RMD registry must define components and attribute targets');
 return r;
}
const code=(s,live=false)=>'~~~~'+(live?'rmd-example':'markdown')+'\n'+s+'\n~~~~';
const types={inline:'行内',block:'多行块级',leaf:'独立单行块级'};
const main={required:'必填',optional:'选填',forbidden:'留空'};
function valueHint(t,r){
 switch(t){
 case 'id':return '字母开头、字母数字连字符、最长 '+r.constraints.idMaximumLength+' 字符（统一小写）';
 case 'integer':return r.constraints.integerMinimum+'–'+r.constraints.integerMaximum+' 整数';
 case 'boolean':return 'true / false';
 case 'color':return r.colors.map(v=>'`'+v+'`').join('、');
 case 'sketch-stroke':return '0.5–6，最多两位小数';
 case 'sketch-padding':return '0–24 CSS px，最多两位小数';
 case 'sketch-roughness':return '0–3，最多两位小数';
 case 'sketch-opacity':return '0.1–0.85，最多两位小数';
 case 'variant':return r.variants.map(v=>'`'+v+'`').join('、');
 default:return '非空字符串；特殊字符可用 JSON 双引号和转义';
 }
}
function params(attrs,positions=[],required=[],defaults={},r){
 if(!Object.keys(attrs).length)return '无具名参数。\n';
 return [
 '| 参数 | 类型与取值 | 填写方式 | 默认值 |',
 '| --- | --- | --- | --- |',
 ...Object.entries(attrs).map(([k,v])=>{
  const i=positions.indexOf(k);
  return '| `'+k+'` | `'+v+'` · '+valueHint(v,r)+' | '+(required.includes(k)?'必填':'选填')+(i<0?'':'，可作第 '+(i+1)+' 个位置参数')+' | '+(Object.hasOwn(defaults,k)?'`'+defaults[k]+'`':'—')+' |';
 })
 ].join('\n')+'\n';
}
export function renderComponent(c,r,detail=false){
 const exampleSyntax=c.type==='inline'?':: '+c.name+(c.main==='required'?' 正文':c.main==='optional'?' [正文]':'')+' [| 参数] ::':
 c.type==='leaf'?'::: '+c.name+' 目标 [| 参数] :::':
 '::: '+c.name+(c.main==='required'?' 标题':c.main==='optional'?' [标题]':'')+' [| 参数]\n\nMarkdown 正文\n\n:::';
 const out=[
 detail?'## '+types[c.type]+'写法':'## `'+c.name+'` · '+types[c.type],
 '',
 c.summary,'',
 (c.type==='leaf'?'目标':c.type==='inline'?'正文':'标题')+main[c.main]+'。'+(c.positions.length?'位置参数依次为 '+c.positions.map(p=>'`'+p+'`').join('、')+'，填写在具名参数前。':''),'',
 '### 基本写法','','将下面的占位内容替换为自己的文字。','','~~~~text\n'+exampleSyntax+'\n~~~~','',
 '### 参数','',
 params(c.attributes,c.positions,c.requiredAttributes??[],c.defaults??{},r)
 ];
 if(c.allowedParents)out.push('放置在 '+c.allowedParents.map(x=>'`'+x+'`').join('、')+' 容器中。','');
 if(c.children)out.push('内部使用 '+c.children.map(x=>'`'+x+'`').join('、')+' 子容器。','');
 if(c.orderedChildren)out.push('子容器按 '+c.orderedChildren.map(x=>'`'+x+'`').join(' → ')+' 顺序排列，每种各一组。','');
 if(c.note)out.push(c.note,'');
 if(c.name==='highlight')out.push('默认使用黄色手绘荧光笔效果，颜色选填。','');
 if(c.name==='embed')out.push('目标填写 `id:UUID` 或完整虚拟路径，使用 `#anchor-id` 选择标题或段落。','');
 if(c.name==='link-card')out.push('目标填写完整的 HTTP(S) 网址。','');
 out.push('### 示例','',code(c.example,true),'');
 return out.join('\n');
}
export function renderNode(n,r,detail=false){
 return [
  ...(detail?[]:['## `@ attrs` · '+n.label+'（`'+n.node+'`）','']),
  n.summary,'',
  '属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。','',
  '### 参数','',
  params(n.attributes,[],[],{},r),
  ...(n.editorIdPrefix?['在块编辑面板中设置 ID 时，使用 `'+n.editorIdPrefix+'` 前缀。','']:[]),
  '块编辑面板中的文本参数使用单行文字，最多 '+r.constraints.stringEditorMaximumLength+' 字符。','',
  '### 示例','',code(n.example,true),''
 ].join('\n');
}
export function renderRegistry(r){
 return [
 '# RMD 1.0 完整语法参考','',
 '已定义 '+r.components.length+' 种语法形式、'+new Set(r.components.map(c=>c.name)).size+' 个不同组件名称及 '+r.nodes.length+' 类块属性目标。',
 '行内使用 `:: 名称 正文 | 参数 ::`；多行块级使用独立的 `::: 名称` 和 `:::`；独立块级使用 `::: 名称 目标 :::`。',
 '允许最多 '+r.constraints.containerDepthMaximum+' 层嵌套；围栏冒号不超过 '+r.constraints.fenceLengthMaximum+' 个；超限、未知或非法语法全部保留原文。',
 '',
 '## 组件目录','',
 '| 类别 | 组件 |','| --- | --- |',
 ...['inline','block','leaf'].map(type=>'| '+types[type]+' | '+r.components.filter(c=>c.type===type).map(c=>'`'+c.name+'`').join('、')+' |'),
 '',
 '## 组件与参数详解','',
 ...r.components.map(c=>renderComponent(c,r)),
 '## `@ attrs` 支持的 Markdown 对象','',
 '| 对象 | 可用属性 |','| --- | --- |',
 ...r.nodes.map(n=>'| '+n.label+' | '+Object.keys(n.attributes).map(p=>'`'+p+'`').join('、')+' |'),
 '',
 ...r.nodes.map(n=>renderNode(n,r)),
 '## 参数填写与使用提示','',
 '- 属性值非空；使用空格包围的 ` | ` 分隔参数；位置参数必须先于具名参数。',
 '- 普通值可不带引号，含分隔竖线等特殊字符使用 JSON 风格双引号及转义。',
 '- 将 `@ attrs` 放在对应块的同行末尾，或紧贴整个块之后的独立行。',
 '- 代码、公式、HTML 与链接 URL 中的伪语法不会被解释成 RMD 组件。',
 '- 文稿名称、路径和标签在文稿信息中设置，权限通过授权管理。',
 '- 默认值栏中的 — 表示此处没有指定默认值。',
 '- 格式无效的内容按原文显示，可以检查组件名称、参数与闭合标记。',
 ''
 ].join('\n');
}
export function registryDetailCatalog(r){
 const components={},nodes={};
 for(const c of r.components){
  if(!components[c.name])components[c.name]={name:c.name,title:'RMD 组件 '+c.name,forms:[],formContent:{},content:''};
  components[c.name].forms.push(c.type);
  components[c.name].formContent[c.type]='# '+c.name+'\n\n'+renderComponent(c,r,true);
 }
 for(const [name,page] of Object.entries(components))page.content='# '+name+'\n\n'+r.components.filter(c=>c.name===name).map(c=>renderComponent(c,r,true)).join('\n');
 for(const n of r.nodes)nodes[n.node]={name:n.node,title:n.label+'属性',content:'# '+n.label+'属性\n\n'+renderNode(n,r,true)};
 return {components,nodes};
}

export function mcpRegistryCatalog(r){
 const hints={id:`letters, digits, hyphens; start with a letter; max ${r.constraints.idMaximumLength} characters`,
  integer:`${r.constraints.integerMinimum}–${r.constraints.integerMaximum}`,
  color:r.colors.join(', '), variant:r.variants.join(', '), 'sketch-stroke':'0.5–6',
  'sketch-padding':'0–24 px', 'sketch-roughness':'0–3', 'sketch-opacity':'0.1–0.85'};
 const fields=(attrs,required=[],defaults={})=>Object.entries(attrs).map(([name,type])=>
  `- \`${name}\`: \`${type}\`${hints[type]?` (${hints[type]})`:''}${required.includes(name)?'; required':''}${Object.hasOwn(defaults,name)?`; default: \`${defaults[name]}\``:''}`);
 const components={},nodes={};
 for(const c of r.components){
  const label=c.type==='inline'?'Text':c.type==='leaf'?'Target':'Title';
  const form=[`## ${c.name} (${c.type})`,`${label}: ${c.main}.`,
   ...(c.positions.length?[`Positional arguments: ${c.positions.join(', ')} (before named arguments).`]:[]),
   ...(c.allowedParents?[`Parent: ${c.allowedParents.join(' or ')}.`]:[]),
   ...(c.orderedChildren?[`Exactly one of each, in order: ${c.orderedChildren.join(' → ')}.`]:c.children?[`Children: ${c.children.join(', ')}.`]:[]),
   ...fields(c.attributes,c.requiredAttributes,c.defaults),'',code(c.example)].join('\n');
  (components[c.name]??={})[c.type]=form;
 }
 for(const n of r.nodes)nodes[n.node]=[`## ${n.node} attributes`,...fields(n.attributes),'',code(n.example)].join('\n');
 const rules=`Separate parameters with \` | \`; use JSON double quotes for values containing separators. Put \`@ attrs\` at the end of its block or on the next line. Nest at most ${r.constraints.containerDepthMaximum} containers; use at most ${r.constraints.fenceLengthMaximum} fence colons.`;
 const reference=[rules,...Object.values(components).flatMap(Object.values),...Object.values(nodes)].join('\n\n');
 return {components,nodes,reference};
}
