import test from 'node:test';
import assert from 'node:assert/strict';
import {rmdCompletionCandidates,guessRmdAttrsTarget,rmdCompletionSource} from '../web/src/rmd-completion';
import {EditorState} from '@codemirror/state';
import {CompletionContext} from '@codemirror/autocomplete';
import {markdown} from '@codemirror/lang-markdown';
import {RMD_REGISTRY,attrsByBlock} from '../web/src/rmd-schema';
const labels=(before:string,previousLine='')=>
 rmdCompletionCandidates(before,previousLine)?.entries.map(x=>x.label)??[];

test('source completions use only registered inline and block components',()=>{
 const inline=labels('说明 :: ');
 assert.deepEqual(new Set(inline),new Set(RMD_REGISTRY.components.filter(c=>c.type==='inline').map(c=>c.name)));
 const blocks=labels('::: ');
 assert.deepEqual(new Set(blocks),new Set(RMD_REGISTRY.components.filter(c=>c.type!=='inline').map(c=>c.name)));
 assert.deepEqual(labels('::: lin'),['link-card']);
 assert.deepEqual(labels('正文 :: tool'),['tooltip']);
 assert.ok(!labels('正文 :: ').includes('link-card'));
 assert.ok(!labels('::: ').includes('kbd'));
});

test('RMD named keys and enum values follow component-specific schema',()=>{
 assert.deepEqual(labels('正文 :: badge 已完成 | variant=s'),['success']);
 assert.deepEqual(labels('正文 :: highlight 重点 | color=pu'),['purple']);
 assert.ok(labels('正文 :: badge 已完成 | ').includes('variant='));
 assert.ok(labels('正文 :: badge 已完成 | ').includes('success'));
 assert.deepEqual(labels('正文 :: badge 已完成 | s'),['success']);
 assert.deepEqual(labels('正文 :: highlight 重点 | pu'),['purple']);
 assert.deepEqual(labels('正文 :: tooltip 术语 | '),['description=']);
 assert.deepEqual(labels('正文 :: kbd Ctrl | '),[]);
 assert.ok(labels('::: highlight | ').includes('color='));
 assert.ok(labels('::: highlight | ').includes('red'));
 assert.deepEqual(labels('::: link-card https://example.com | '),['title=']);
});

test('RMD source mode does not complete inside Markdown fenced code',()=>{
 const outside='正文 :: ba';
 const visible=new CompletionContext(EditorState.create({doc:outside,extensions:[markdown()]}),outside.length,false);
 assert.ok(rmdCompletionSource(visible)?.options.some(x=>x.label==='badge'));
 const fenced='~~~markdown\n:: badge';
 const hidden=new CompletionContext(EditorState.create({doc:fenced,extensions:[markdown()]}),fenced.length,true);
 assert.equal(rmdCompletionSource(hidden),null);
});

test('@ attrs never offers properties from unrelated Markdown block kinds',()=>{
 assert.equal(guessRmdAttrsTarget('## 标题 ','') ,'heading');
 assert.equal(guessRmdAttrsTarget('![图](a.png) ','') ,'image');
 assert.equal(guessRmdAttrsTarget('','$$'),'math');
 assert.equal(guessRmdAttrsTarget('','~~~ts'),'code');
 assert.equal(guessRmdAttrsTarget('','| 数据 |'),'table');
 for(const [node,prefix,previous] of [
  ['heading','## 标题 @ attrs | ',''],
  ['paragraph','正文 @ attrs | ',''],
  ['image','![图](a.png) @ attrs | ',''],
  ['math','@ attrs | ','$$'],
  ['table','@ attrs | ','| 电压 | 220 |'],
  ['code','@ attrs | ','~~~']
 ]){
  const options=labels(prefix,previous);
  assert.deepEqual(new Set(options),
   new Set(Object.keys(attrsByBlock[node]!).map(x=>x+'=')),
   'incorrect completions for '+node);
 }
 assert.deepEqual(labels('![图](a.png) @ attrs | wi'),['width=']);
});
