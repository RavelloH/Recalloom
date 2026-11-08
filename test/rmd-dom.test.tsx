import React from 'react';
import ReactMarkdown from 'react-markdown';
import {renderToStaticMarkup} from 'react-dom/server';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {shieldRmdTablePipes} from '../web/src/rmd-lexer';
import {remarkRmdSyntax} from '../web/src/rmd-remark';
import {projectRmdPreview} from '../web/src/rmd-preview';

function render(source:string){
 const confirmed=projectRmdPreview(source);
 return renderToStaticMarkup(
  <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,()=>remarkRmdSyntax(confirmed)]}
   rehypePlugins={[rehypeKatex]}>
   {shieldRmdTablePipes(confirmed)}
  </ReactMarkdown>
 );
}
describe('RMD semantic HTML integration',()=>{
 it('renders default Mark identically to native mark and distinguishes yellow Highlight',()=>{
  const html=render('普通 :: mark $E=mc^2$ ::，彩色 :: highlight 重要 | yellow ::。');
  assert.ok(html.includes('<mark>'),html.slice(0,1500));
  assert.ok(html.includes('data-rk-color="yellow"'),html.slice(0,1500));
  assert.ok(html.includes('katex'),html.slice(0,1000));
 });
 it('preserves full display math inside block Mark independently from colored Highlight',()=>{
  const src=['::: mark','','$$','E=mc^2','$$','',':::','','::: highlight | yellow','','重点','',':::'].join('\n');
  const html=render(src);
  assert.equal((html.match(/<rk-rmd-block-mark/g)??[]).length,2,html.slice(0,4000));
  assert.ok(html.includes('data-rk-color="yellow"'),html.slice(0,4000));
  assert.ok(html.includes('katex-display'));
 });
 it('protects component pipes from GFM and still recognizes a two-column table',()=>{
  const src=['| 名称 | 状态 |','| --- | --- |','| 部署 | :: badge 完成 | success :: |'].join('\n');
  const html=render(src);
  const header=html.match(/<th(?:>|\s)/g)??[];
  const cells=html.match(/<td/g)??[];
  assert.equal(header.length,2,html);
  assert.equal(cells.length,2,html);
  assert.ok(html.includes('<rk-badge'),html);
  assert.ok(html.includes('data-variant="success"'),html);
 });
 it('hides valid comments and pending suggestions but preserves malformed candidates',()=>{
  const source='原文 %%内部注释%% {++新增++} {--保留--}，无效 %%未闭合';
  const html=render(source);
  assert.ok(html.includes('保留'),html);
  assert.ok(html.includes('%%未闭合'),html);
  assert.ok(!html.includes('内部注释'),html);
  assert.ok(!html.includes('新增'),html);
 });
 it('attaches stable RMD formula IDs without losing KaTeX display content',()=>{
  const src=['$$','P=UI','$$','@ attrs eq-power @'].join('\n');
  const html=render(src);
  assert.ok(html.includes('rk-numbered-math'),html);
  assert.ok(html.includes('data-id="eq-power"'),html);
  assert.ok(html.includes('katex-display'),html);
 });
 it('renders valid figure attributes without showing modifier text',()=>{
  const src='![实验](device.png) @ attrs fig-device | width=480 | caption=实验装置 @';
  const html=render(src);
  assert.ok(html.includes('<rk-figure'),html);
  assert.ok(!html.includes('@ attrs'),html);
 });
});
