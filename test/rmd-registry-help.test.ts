import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../src/rmd/registry.json';
import {RMD_SCHEMA,attrsByBlock,getRmdSchema,RMD_COLORS,RMD_VARIANTS} from '../web/src/rmd-schema';
import {lexRmd} from '../web/src/rmd-lexer';
import {getHelp,RMD_COMPONENT_NAMES,RMD_NODE_NAMES} from '../src/help/index';
import {readFileSync} from 'node:fs';

test('RMD component runtime schema and docs share the same registry with no missing forms',()=>{
 assert.equal(registry.components.length,29);
 assert.equal(registry.nodes.length,6);
 assert.equal(RMD_SCHEMA.size,registry.components.length);
 assert.deepEqual([...RMD_COLORS],registry.colors);
 assert.deepEqual([...RMD_VARIANTS],registry.variants);
 assert.deepEqual(new Set(RMD_COMPONENT_NAMES),new Set(registry.components.map(c=>c.name)));
 assert.deepEqual(new Set(RMD_NODE_NAMES),new Set(registry.nodes.map(n=>n.node)));
 assert.deepEqual(Object.keys(attrsByBlock),registry.nodes.map(n=>n.node));
 const reference=readFileSync('docs/rmd-syntax-reference.generated.md','utf8');
 assert.match(reference,/29 种语法形式/);
 assert.equal((reference.match(/~~~~rmd-example\r?\n/g)??[]).length,registry.components.length+registry.nodes.length,
  'every complete component and attrs example must be marked for the real Web preview');
 assert.equal((reference.match(/~~~~text\r?\n/g)??[]).length,registry.components.length,
  'non-executable syntax templates must stay plain text');
 for(const component of registry.components){
  const type=component.type as 'inline'|'block'|'leaf';
  const schema=getRmdSchema(type,component.name);
  assert.ok(schema,component.name+'/'+type);
  assert.equal(schema!.main,component.main);
  assert.deepEqual(schema!.positions,component.positions);
  assert.deepEqual(schema!.attributes,component.attributes);
  assert.deepEqual(schema!.children,('children'in component)?component.children:undefined);
  assert.deepEqual(schema!.allowedParents,('allowedParents'in component)?component.allowedParents:undefined);
  assert.deepEqual(schema!.orderedChildren,('orderedChildren'in component)?component.orderedChildren:undefined);
  assert.deepEqual(schema!.requiredAttributes,('requiredAttributes'in component)?component.requiredAttributes:undefined);
  const flat=(items:ReturnType<typeof lexRmd>):ReturnType<typeof lexRmd>=>items.flatMap(c=>[c,...flat(c.children??[])]);
  const token=flat(lexRmd(component.example)).find(c=>c.name===component.name&&c.type===type);
  assert.ok(token,component.name+'/'+type+' has an invalid published example: '+component.example);
  const detail=getHelp('markdown',{component:component.name,kind:type});
  assert.equal(detail.topic,'markdown');
  assert.ok(detail.content.includes(component.summary));
  assert.ok(detail.content.includes(component.example));
  for(const [field,kind] of Object.entries(component.attributes)){
   assert.ok(detail.content.includes('`'+field+'`'),component.name+' missing field '+field);
   assert.ok(detail.content.includes('`'+kind+'`'),component.name+' missing type '+kind);
  }
 }
 for(const node of registry.nodes){
  const help=getHelp('markdown',{node:node.node});
  assert.equal(help.topic,'markdown');
  assert.ok(help.content.includes(node.example),node.node);
  assert.deepEqual(attrsByBlock[node.node],node.attributes);
  assert.deepEqual(new Set(Object.keys(node.fieldLabels)),new Set(Object.keys(node.attributes)),
   'UI field labels must be generated from every schema property');
  for(const field of Object.keys(node.attributes))
   assert.ok(help.content.includes('`'+field+'`'),node.node+' missing '+field);
  assert.match(help.content,/240 字符/,'missing UI input limit');
  if('editorIdPrefix' in node)assert.ok(help.content.includes('`'+node.editorIdPrefix+'`'),'missing editor ID prefix for '+node.node);
  const attr=lexRmd(node.example).find(c=>c.type==='attrs');
  assert.ok(attr,node.node+' invalid attrs example');
  assert.equal(attr!.name,node.node);
 }
});

test('MCP full markdown help includes machine-generated complete component and attrs reference',()=>{
 const page=getHelp('markdown');
 assert.match(page.content,/RMD 1\.0 完整语法参考（自动生成）/);
 for(const component of RMD_COMPONENT_NAMES)assert.ok(page.content.includes('`'+component+'`'),component);
 for(const node of RMD_NODE_NAMES)assert.ok(page.content.includes('`'+node+'`'),node);
 assert.equal(getHelp('markdown',{component:'mark'}).content.includes('行内'),true);
 assert.equal(getHelp('markdown',{component:'mark'}).content.includes('多行块级'),true);
 assert.equal(getHelp('markdown',{component:'mark',kind:'inline'}).content.includes('多行块级'),false);
 assert.throws(()=>getHelp('math',{component:'badge'}),/topic markdown/);
 assert.throws(()=>getHelp('markdown',{component:'not-a-component'}),/Unknown RMD component/);
 assert.throws(()=>getHelp('markdown',{node:'not-a-node'}),/Unknown RMD node/);
 assert.throws(()=>getHelp('markdown',{component:'mark',kind:'leaf'}),/Unsupported RMD component form/);
});
