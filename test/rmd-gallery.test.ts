import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe,it} from 'node:test';
import {lexRmd,type RmdSyntaxNode} from '../web/src/rmd-lexer';
import {RMD_SCHEMA} from '../web/src/rmd-schema';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
const source=readFileSync('docs/rmd-1.0-syntax-showcase.md','utf8');
const flatten=(items:RmdSyntaxNode[]):RmdSyntaxNode[]=>items.flatMap(item=>[item,...flatten(item.children??[])]);
describe('RMD 1.0 published syntax showcase',()=>{
 it('covers every schema component and all nine Highlight colors',()=>{
  const tokens=flatten(lexRmd(source));
  const available=new Set(tokens.map(token=>token.type+':'+token.name));
  const required=[...RMD_SCHEMA.keys()];
  assert.deepEqual(required.filter(name=>!available.has(name)),[],'showcase must exercise all canonical RMD component shapes');
  for(const color of ['red','orange','yellow','green','blue','purple','pink','cyan','teal'])
   assert.ok(tokens.some(token=>token.name==='highlight'&&token.attributes.color===color),color);
  assert.ok(tokens.filter(x=>x.type==='attrs').length>=10,'must demonstrate block ID schema');
 });
 it('round-trips as an editable document without accidental fallback and with stable canonical output',()=>{
  const doc=parseRmdVisual(source);
  const once=serializeRmdVisual(doc);
  const twice=serializeRmdVisual(parseRmdVisual(once));
  assert.equal(twice,once,'gallery itself must be safe to open in Visual and save twice');
  const walk=(node:any):any[]=>[node,...(node.content??[]).flatMap(walk)];
  const raws=walk(doc).filter(node=>node.type==='rawMarkdown');
  assert.equal(raws.length,0,'no unparseable block in the showcase: '+JSON.stringify(raws).slice(0,900));
 });
});
