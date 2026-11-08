import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {parseDirectiveAttributes,parseInlineDirectiveSource,directiveAttributeString} from '../web/src/markdown-attrs';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import {remarkRichTransforms} from '../web/src/rich-remark';
describe('uniform Markdown attribute quoting',()=>{
 it('parses JSON escaped double quotes, braces, and backslashes',()=>{
  const value='JSON {"key": 2} and \\ path';
  const encoded=directiveAttributeString(value);
  assert.equal(parseDirectiveAttributes('content='+encoded)?.content,value);
  const parsed=parseInlineDirectiveSource(':tooltip[帮助]{content='+encoded+'}','tooltip');
  assert.equal(parsed?.attrs.content,value);
  assert.equal(parsed?.label,'帮助');
 });
 it('requires quotes for spaces and rejects invalid duplicate/unclosed attributes',()=>{
  assert.equal(parseDirectiveAttributes('content=with spaces'),null);
  assert.equal(parseDirectiveAttributes('content="unclosed'),null);
  assert.equal(parseDirectiveAttributes('variant=success variant=warning'),null);
  assert.deepEqual(parseDirectiveAttributes('variant=success'),{variant:'success'});
 });
 it('read-only remark projection uses the same safe attribute parser',()=>{
  const value='Quoted "text" and {braces}';
  const source=':tooltip[这里]{content='+directiveAttributeString(value)+'}';
  const tree=unified().use(remarkParse).use(remarkDirective).parse(source) as any;
  remarkRichTransforms(source)(tree);
  assert.equal(tree.children?.[0]?.children?.[0]?.data?.hProperties?.dataContent,value);
 });
 it('read-only projection recognizes only :tooltip, not the removed :tip syntax',()=>{
  const source=':tip[旧语法]{content="旧提示"}，:tooltip[新语法]{content="新提示"}';
  const tree=unified().use(remarkParse).use(remarkDirective).parse(source) as any;
  remarkRichTransforms(source)(tree);
  const nodes=tree.children?.[0]?.children??[];
  assert.ok(nodes.some((node:any)=>node.type==='text'&&String(node.value).includes(':tip[旧语法]')));
  assert.equal(nodes.filter((node:any)=>node.data?.hName==='rk-tooltip').length,1);
  assert.ok(!nodes.some((node:any)=>node.data?.hName==='rk-tip'));
 });
});
