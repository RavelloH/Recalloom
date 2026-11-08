import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {remarkRmdSyntax} from '../web/src/rmd-remark';
import {shieldRmdTablePipes} from '../web/src/rmd-lexer';
const id='550e8400-e29b-41d4-a716-446655440000';
type Ast={type:string;data?:{hName?:string;hProperties?:Record<string,string>};children?:Ast[]};
const parse=(source:string)=>{
 const ast=unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(shieldRmdTablePipes(source)) as Ast;
 remarkRmdSyntax(source)(ast);
 return ast;
};
const find=(ast:Ast,name:string):Ast[]=>[
 ...(ast.data?.hName===name?[ast]:[]),...(ast.children??[]).flatMap(c=>find(c,name))
];
describe('shared read-only RMD Wiki AST projection',()=>{
 it('projects an explicit valid embed and preserves surrounding Markdown',()=>{
  const source=['# 标题','','::: embed id:'+id+'#^important-block :::','','正文 **强调**。'].join('\n');
  const ast=parse(source);
  const nodes=find(ast,'wiki-embed');
  assert.equal(nodes.length,1,JSON.stringify(ast));
  assert.equal(nodes[0]?.data?.hProperties?.dataTarget,'id:'+id);
  assert.equal(nodes[0]?.data?.hProperties?.dataAnchor,'^important-block');
  assert.ok(JSON.stringify(ast).includes('strong'));
 });
 it('never interprets code, inline code, malformed names or old-style embeds',()=>{
  const tick=String.fromCharCode(96);
  const source=[
   '::: embed 文档名称 :::',
   '',
   '{{embed:id:'+id+'}}',
   '',
   tick+'::: embed id:'+id+' :::'+tick,
   '',
   '~~~markdown',
   '::: embed id:'+id+' :::',
   '~~~',
   '',
   '合法 [[id:'+id+']]。'
  ].join('\n');
  const ast=parse(source);
  assert.equal(find(ast,'wiki-embed').length,0);
  assert.equal(find(ast,'wiki-ref').length,1);
  assert.ok(JSON.stringify(ast).includes('{{embed:'));
 });
 it('keeps two columns with unescaped wiki alias pipe before GFM tokenization',()=>{
  const source='| 说明 | 目标 |\n| --- | --- |\n| A | [[id:'+id+'|别名]] |';
  const ast=parse(source);
  const table=ast.children?.find(x=>x.type==='table');
  assert.equal(table?.children?.[0]?.children?.length,2,JSON.stringify(ast));
  assert.equal(table?.children?.[1]?.children?.length,2,JSON.stringify(ast));
  assert.equal(find(ast,'wiki-ref').length,1);
 });
});
