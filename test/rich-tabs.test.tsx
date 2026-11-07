import React from 'react';
import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import {remarkRichTransforms} from '../web/src/rich-remark';
import {TabsPreview} from '../web/src/rich-tabs';
import {richTitle} from '../web/src/tiptap/rich-schema';

const source=['::::tabs','',':::tab[概览]','','第一栏 **强调**。','',':::','',':::tab[实现]','','第二栏 @@const a=1@@。','',':::','','::::'].join('\n').replaceAll('@@',String.fromCharCode(96));
function ReadOnlyTabs(){
 return <ReactMarkdown remarkPlugins={[remarkDirective,()=>remarkRichTransforms(source)]}
  components={{
   'rk-callout':({node:_node,...props}:any)=>{
    const kind=String(props['data-kind']??'');
    if(kind==='tabs')return <TabsPreview>{props.children}</TabsPreview>;
    if(kind==='tab')return <div data-read-tab={richTitle(kind,String(props['data-title']??''))}>{props.children}</div>;
    return <div>{props.children}</div>;
   }
  } as any}>{source}</ReactMarkdown>;
}
describe('Astryx tabs in read-only Markdown',()=>{
 it('presents semantic tablist with each tab panel retaining Markdown content',()=>{
  const html=renderToStaticMarkup(<ReadOnlyTabs/>);
  assert.match(html,/role="tablist"/);
  assert.match(html,/role="tabpanel"/);
  assert.match(html,/data-read-tab="概览"/);
  assert.match(html,/data-read-tab="实现"/);
  assert.match(html,/<strong>强调<\/strong>/);
  assert.match(html,/hidden/);
  assert.match(html,/第二栏/);
 });
});
