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
const main={required:'必填',optional:'选填',forbidden:'禁止'};
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
 '| 参数 | 类型 | 位置 | 必填 | 默认值 | 合法范围 |',
 '| --- | --- | --- | --- | --- | --- |',
 ...Object.entries(attrs).map(([k,v])=>{
  const i=positions.indexOf(k);
  return '| `'+k+'` | `'+v+'` | '+(i<0?'无':'第 '+(i+1)+' 个')+' | '+(required.includes(k)?'是':'否')+' | '+(Object.hasOwn(defaults,k)?'`'+defaults[k]+'`':'未声明')+' | '+valueHint(v,r)+' |';
 })
 ].join('\n')+'\n';
}
export function renderComponent(c,r){
 const exampleSyntax=c.type==='inline'?':: '+c.name+(c.main==='required'?' 正文':c.main==='optional'?' [正文]':'')+' [| 参数] ::':
 c.type==='leaf'?'::: '+c.name+' 目标 [| 参数] :::':
 '::: '+c.name+(c.main==='required'?' 标题':c.main==='optional'?' [标题]':'')+' [| 参数]\n\nMarkdown 正文\n\n:::';
 const out=[
 '## `'+c.name+'` · '+types[c.type],
 '',
 c.summary,'',
 '- **类型**：'+types[c.type]+'。',
 '- **主文本／标题**：'+main[c.main]+'。',
 '- **位置参数**：'+(c.positions.length?c.positions.map((p,i)=>(i+1)+'. `'+p+'`').join('；'):'无')+'；位置参数必须位于具名参数前。',
 '- **语法模板（占位符，不能直接作为正文）**：','','~~~~text\n'+exampleSyntax+'\n~~~~','',
 params(c.attributes,c.positions,c.requiredAttributes??[],c.defaults??{},r)
 ];
 if(c.allowedParents)out.push('**合法父容器**：'+c.allowedParents.map(x=>'`'+x+'`').join('、')+'。','');
 if(c.children)out.push('**合法子容器**：'+c.children.map(x=>'`'+x+'`').join('、')+'。','');
 if(c.orderedChildren)out.push('**子容器顺序与数量**：'+c.orderedChildren.map(x=>'`'+x+'`').join(' → ')+'；必须恰好一次。','');
 if(c.note)out.push('**额外约束**：'+c.note,'');
 if(c.name==='highlight')out.push('**默认黄色手绘荧光笔**；颜色可以省略。它与规整的语义 `mark` 是不同组件，历史的 `highlight` 文档仍可解析。','');
 if(c.name==='embed')out.push('**目标**：`id:UUID` 或绝对虚拟路径；标题和段落统一使用 `#anchor-id`。','');
 if(c.name==='link-card')out.push('**目标**：HTTP(S) URL，不允许 javascript: 等脚本协议。','');
 out.push('**完整示例**：','',code(c.example,true),'');
 return out.join('\n');
}
export function renderNode(n,r){
 return [
  '## `@ attrs` · '+n.label+'（`'+n.node+'`）','',
  n.summary,'',
  '属性选填；稳定 ID 可作为首个位置参数（`@ attrs my-id @`），也可写为具名 `id=my-id`，不能重复。','',
  params(n.attributes,[],[],{},r),
  ...(n.editorIdPrefix?['**可视化编辑器的 ID 规则**：ID 须以 `'+n.editorIdPrefix+'` 开头；源码级 RMD 解析器仍接受所有合法 ID。','']:[]),
  '**可视化编辑限制**：字符串参数不超过 '+r.constraints.stringEditorMaximumLength+' 字符、不能包含换行；这些限制不等于源码 `string` 解析器的最大长度。','',
  '**完整示例**：','',code(n.example,true),''
 ].join('\n');
}
export function renderRegistry(r){
 return [
 '# RMD 1.0 完整语法参考（自动生成）','',
 '> 来源：`src/rmd/registry.json`。请勿直接手改生成文件。',
 '',
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
 '## 统一规则与错误回退','',
 '- 属性值非空；使用空格包围的 ` | ` 分隔参数；位置参数必须先于具名参数。',
 '- 普通值可不带引号，含分隔竖线等特殊字符使用 JSON 风格双引号及转义。',
 '- `@ attrs` 仅修饰合法 Markdown 块，同行附着当前块或下一行紧贴前一完整块；不得猜测跨空行归属。',
 '- 代码、公式、HTML 与链接 URL 中的伪语法不会被解释成 RMD 组件。',
 '- 文档路径、标签及权限是数据库元信息，不从 YAML Front Matter 推导。',
 '- 未注册的组件、属性和非法参数直接显示为原文，不创建半成品组件。',
 ''
 ].join('\n');
}
export function registryDetailCatalog(r){
 const components={},nodes={};
 for(const c of r.components){
  if(!components[c.name])components[c.name]={name:c.name,title:'RMD 组件 '+c.name,forms:[],formContent:{},content:''};
  components[c.name].forms.push(c.type);
  components[c.name].formContent[c.type]='# RMD 组件：'+c.name+'（'+types[c.type]+'）\n\n'+renderComponent(c,r);
 }
 for(const [name,page] of Object.entries(components))page.content='# RMD 组件：'+name+'\n\n'+r.components.filter(c=>c.name===name).map(c=>renderComponent(c,r)).join('\n');
 for(const n of r.nodes)nodes[n.node]={name:n.node,title:'RMD 块属性：'+n.label,content:'# RMD 块属性：'+n.label+'\n\n'+renderNode(n,r)};
 return {components,nodes};
}
