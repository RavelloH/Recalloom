import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type {JSONContent} from '@tiptap/core';
import {SKETCH_KINDS,SKETCH_BLOCK_KINDS,sketchPaths,sketchSeed,parseSketchNumber} from '../web/src/sketch-geometry';
import {getRmdSchema,isValidRmdValue} from '../web/src/rmd-schema';
import {lexRmd} from '../web/src/rmd-lexer';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import {remarkRmdSyntax} from '../web/src/rmd-remark';
const walk=(node:JSONContent):JSONContent[]=>[node,...(node.content??[]).flatMap(walk)];
const save=(source:string)=>{
 const doc=parseRmdVisual(source);
 const once=serializeRmdVisual(doc);
 assert.equal(serializeRmdVisual(parseRmdVisual(once)),once,'roundtrip drift: '+once);
 return {doc,once};
};
describe('RMD static hand-drawn marks',()=>{
 it('registers nine inline styles and exactly six block styles, without claiming HTML underline',()=>{
  assert.equal(SKETCH_KINDS.length,9);
  assert.equal(SKETCH_BLOCK_KINDS.length,6);
  for(const kind of SKETCH_KINDS)assert.ok(getRmdSchema('inline',kind),kind);
  for(const kind of SKETCH_BLOCK_KINDS)assert.ok(getRmdSchema('block',kind),kind);
  for(const kind of ['dotted-underline','wavy','arrow'])
   assert.equal(getRmdSchema('block',kind),undefined);
 });
 it('has stable distinct SVG geometry with no animation props and no invalid dimensions',()=>{
  const shapes=new Set();
  for(const kind of SKETCH_KINDS){
   const paths=sketchPaths(kind,168,47,sketchSeed('same formula'),1.4);
   assert.deepEqual(paths,sketchPaths(kind,168,47,sketchSeed('same formula'),1.4));
   assert.ok(paths.length>=1,kind);
   for(const path of paths){
    assert.ok(path.d.startsWith('M '),kind+': '+path.d);
    assert.doesNotMatch(path.d,/NaN|Infinity|animation|transition/);
   }
   shapes.add(JSON.stringify(paths));
  }
  assert.equal(shapes.size,9);
  assert.notDeepEqual(sketchPaths('circle',200,60,1),sketchPaths('circle',200,60,2));
 });
 it('accepts bounded numerical attributes and rejects malformed or impossible styles',()=>{
  for(const [key,good,bad] of [
   ['sketch-stroke','2.5','20'],
   ['sketch-padding','6','99'],
   ['sketch-roughness','1.4','-1'],
   ['sketch-opacity','0.55','1'],
  ]) {
   assert.equal(isValidRmdValue(key,good),true,key);
   assert.equal(isValidRmdValue(key,bad),false,key);
  }
  assert.equal(parseSketchNumber('3.333','stroke'),undefined);
  for(const source of [
   ':: circle 词语 | color=not-a-color ::',
   ':: box 公式 | padding=999 ::',
   ':: highlight 文字 | opacity=1.9 ::',
   ':: wavy 文本 | stroke=0 ::',
  ])assert.deepEqual(lexRmd(source),[],source);
 });
 it('roundtrips nine inline styles, including a colored formula and optional default highlight',()=>{
  for(const kind of SKETCH_KINDS){
   const source='结论 :: '+kind+' $E=mc^2$ | color=blue | stroke=2.5 | padding=4 | roughness=1.3'+(kind==='highlight'?' | opacity=0.55':'')+' ::。';
   const {doc,once}=save(source);
   assert.ok(once.includes(':: '+kind+' $E=mc^2$'),once);
   const math=walk(doc).find(n=>n.type==='inlineMath');
   assert.ok(math?.marks?.some(m=>m.type==='rmdSketch'&&m.attrs?.kind===kind),'math mark '+kind);
   assert.ok(once.includes('color=blue'),once);
  }
  const {doc,once}=save(':: highlight 默认黄色 ::');
  assert.ok(walk(doc).some(n=>n.marks?.some(m=>m.type==='rmdSketch'&&m.attrs?.kind==='highlight'&&m.attrs?.color===null)));
  assert.equal(once,':: highlight 默认黄色 ::');
 });
 it('roundtrips six block styles around formulas and prose, preserving actual math nodes',()=>{
  for(const kind of SKETCH_BLOCK_KINDS){
   const source=['::: '+kind+' | color=teal | stroke=2.5 | padding=6','','$$','\\frac{1}{\\sqrt{x}}+\\int_0^1 x\\,dx','$$','',':::'].join('\n');
   const {doc,once}=save(source);
   const block=walk(doc).find(n=>n.type==='richContainer'&&n.attrs?.kind===kind);
   assert.ok(block,'expected '+kind+': '+once);
   assert.ok(walk(block!).some(n=>n.type==='blockMath'),'formula lost inside '+kind);
   assert.ok(once.includes('::: '+kind+' | color=teal'),once);
  }
 });
 it('does not overwrite ordinary semantic mark or safe HTML underline',()=>{
  const {doc,once}=save(':: mark 语义重点 :: 与 <u>普通下划线</u>，还有 :: underline 手绘线 ::。');
  const marks=walk(doc).flatMap(n=>n.marks??[]).map(m=>m.type);
  assert.ok(marks.includes('rmdMark'));
  assert.ok(marks.includes('underline'));
  assert.ok(marks.includes('rmdSketch'));
  assert.ok(once.includes('<u>普通下划线</u>'));
  assert.ok(once.includes(':: underline 手绘线 ::'));
 });
 it('preserves sanitized Remark AST hand-drawn wrappers and KaTeX inline math',()=>{
  const input=':: box $\\frac{1}{2}$ | color=orange :: 和 :: highlight 重点 ::';
  const html=renderToStaticMarkup(
   <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,()=>remarkRmdSyntax(input)]}
    rehypePlugins={[rehypeKatex]}>{input}</ReactMarkdown>
  );
  assert.ok(html.includes('rk-sketch'),html);
  assert.ok(html.includes('data-rk-sketch-kind="box"'),html);
  assert.ok(html.includes('katex'),html);
 });
});
