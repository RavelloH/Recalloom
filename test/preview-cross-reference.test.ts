import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import {collectPreviewRefs,remarkCrossRefDisplay} from '../web/src/markdown-cross-reference';
import {shieldEquationIdClosers} from '../web/src/cross-reference';

type MdNode={type:string;value?:string;children?:MdNode[]};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
function transformed(source:string):MdNode{
 const ast=parser.parse(shieldEquationIdClosers(source)) as MdNode;
 remarkCrossRefDisplay(source)(ast);
 return ast;
}
function emittedRefs(source:string):string[]{
 const found:string[]=[];
 const visit=(node:MdNode)=>{
  if(node.type==='html'&&node.value?.startsWith('<rk-cross-ref '))found.push(node.value);
  for(const child of node.children??[])visit(child);
 };
 visit(transformed(source));
 return found;
}
describe('source-safe Wiki read-only cross references',()=>{
 it('recognizes explicit source references without matching a Markdown escape',()=>{
  const source='参见 @fig-circuit 和 '+String.fromCharCode(92)+'@fig-literal，以及 @eq-power。';
  assert.deepEqual(emittedRefs(source),[
   '<rk-cross-ref data-id="fig-circuit"></rk-cross-ref>',
   '<rk-cross-ref data-id="eq-power"></rk-cross-ref>'
  ]);
 });
 it('does not turn HTML entity-encoded @ into a reference',()=>{
  const source='&#64;fig-entity and @fig-valid\n\nSecond paragraph @tbl-real.';
  const refs=emittedRefs(source);
  assert.deepEqual(refs,['<rk-cross-ref data-id="tbl-real"></rk-cross-ref>']);
 });
 it('keeps code, link labels, and unsupported cross references literal',()=>{
  const tick=String.fromCharCode(96);
  const source=[
   '~~~markdown',
   '@fig-code',
   '~~~',
   '',
   'Read [@fig-link](https://example.org), '+tick+'@eq-inline'+tick+' and @fig-ok.',
   '',
   'Invalid @fig-123 cannot become a reference.'
  ].join('\n');
  assert.deepEqual(emittedRefs(source),['<rk-cross-ref data-id="fig-ok"></rk-cross-ref>']);
 });
 it('computes source-derived, typed figure, equation and table IDs for the projection',()=>{
  const source=[
   '![Diagram](https://example.org/a.png){#fig-a width=480 caption="A"}',
   '',
   '$$',
   'x=1',
   '$$ {#eq-a}',
   '',
   '| Name | Count |',
   '| --- | ---: |',
   '| A | 1 |',
   '',
   ': Counts {#tbl-a}',
   '',
   '~~~math',
   '$$',
   'x=1',
   '$$ {#eq-ignored}',
   '~~~'
  ].join('\n');
  const refs=collectPreviewRefs(source);
  assert.deepEqual([...refs.values()].map(x=>[x.id,x.label]),[
   ['fig-a','图 1'],['eq-a','公式 1'],['tbl-a','表 1']
  ]);
  const ast=transformed(source);
  const equations:string[]=[];
  const visit=(node:MdNode)=>{if(node.type==='html'&&node.value?.startsWith('<rk-numbered-math '))equations.push(node.value);for(const c of node.children??[])visit(c);};
  visit(ast);
  assert.equal(equations.length,1);
  assert.ok(equations[0]!.includes('data-id="eq-a"'));
  assert.ok(!equations[0]!.includes('eq-ignored'));
 });
});
