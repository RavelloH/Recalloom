import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {BlockMathWithHighlight} from '../web/src/tiptap/block-math-highlight';
import {InlineMathWithHighlight} from '../web/src/tiptap/inline-math-highlight';
import {HighlightWithMarkdown} from '../web/src/tiptap/markdown-extensions';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {markedDisplayLatex} from '../web/src/tiptap/marked-display-math';

const manager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false}),
 CustomHeading,CustomParagraph,Markdown,HighlightWithMarkdown,
 InlineMathWithHighlight,BlockMathWithHighlight
]});

const formula='\\begin{aligned}\nR_T &= \\frac{\\Delta P_s U_N^2}{S_N^2}\\times1000\\\\\nX_T &\\approx \\frac{U_s\\%}{100}\\frac{U_N^2}{S_N}\\times1000\\\\\nG_T &= \\frac{P_0}{1000U_N^2}\\\\\nB_T &\\approx \\frac{I_0\\%}{100}\\frac{S_N}{U_N^2}\\times10^{-3}\n\\end{aligned}';

describe('marked display math',()=>{
 for(const separator of ['\n','\n\n']){
  it('imports the highlighted aligned formula as an editable block with separator '+JSON.stringify(separator),()=>{
   const source='## 变压器\n\n<mark>'+separator+'$$\n'+formula+'\n$$'+separator+'</mark>\n\nThe end.';
   const parsed=buildVisualMarkdown(source,manager);
   const block=parsed.content?.find(node=>node.type==='blockMath');
   assert.ok(block,'highlighted math must be a blockMath node, not raw text');
   assert.equal(block.attrs?.latex,formula);
   assert.equal(block.attrs?.highlighted,true);
   assert.ok(parsed.content?.some(node=>node.type==='heading'));
   const saved=manager.serialize(parsed);
   assert.match(saved,/<mark>\s*\n\$\$/);
   assert.ok(saved.includes(formula));
   const reopened=buildVisualMarkdown(saved,manager);
   assert.equal(reopened.content?.find(node=>node.type==='blockMath')?.attrs?.highlighted,true);
   assert.equal(reopened.content?.find(node=>node.type==='blockMath')?.attrs?.latex,formula);
  });
 }
 it('rejects incomplete or unrelated HTML wrappers',()=>{
  assert.equal(markedDisplayLatex('<mark>just text</mark>'),null);
  assert.equal(markedDisplayLatex('<mark>\n$$\nx\n$$'),null);
  assert.equal(markedDisplayLatex('<mark>\n$$\nx\n$$\n</mark>\nextra'),null);
 });
 it('keeps ordinary display equations unhighlighted',()=>{
  const parsed=buildVisualMarkdown('$$\nE=mc^2\n$$',manager);
  assert.equal(Boolean(parsed.content?.find(node=>node.type==='blockMath')?.attrs?.highlighted),false);
 });
});
