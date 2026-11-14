import test from 'node:test';
import assert from 'node:assert/strict';
import {previewComparisonTree,scopedPreviewIds,type PreviewHastNode} from '../web/src/markdown-preview-pipeline';
import {revisionWordHighlight} from '../web/src/revision-word-highlight';

function nodes(tree:PreviewHastNode):PreviewHastNode[]{return [tree,...(tree.children??[]).flatMap(nodes)];}
function text(tree:PreviewHastNode):string{
 return tree.type==='text'?(tree as PreviewHastNode&{value:string}).value:(tree.children??[]).map(text).join('');
}
function highlight(current:string,other:string,side:'added'|'removed'){
 const tree=previewComparisonTree(current),original=text(tree);
 revisionWordHighlight(other,side)()(tree);
 assert.equal(text(tree),original,'highlighting must preserve rendered text exactly');
 const marks=nodes(tree).filter(node=>node.tagName==='span'&&(node.properties?.className as string[]|undefined)?.includes('rk-revision-word'));
 return {tree,marks:marks.map(text)};
}

test('revision prose highlights the changed words inside existing emphasis and decoded entities',()=>{
 const before='Hello **world** &amp; old.',after='Hello **world** &amp; new.';
 assert.deepEqual(highlight(before,after,'removed').marks,['old']);
 const added=highlight(after,before,'added');
 assert.deepEqual(added.marks,['new']);
 assert.equal(nodes(added.tree).filter(node=>node.tagName==='strong').length,1);
});

test('revision marks preserve emoji code points and Chinese text',()=>{
 const added=highlight('新方案🚀','旧方案🙂','added');
 assert.equal(added.marks.join(''),'新🚀');
 assert.ok(added.marks.every(value=>!/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(value)));
});

test('revision marks do not change code or math parser input',()=>{
 const current='Text new.\n\n```js\nconst answer = 2;\n```\n\n$$\nx^2\n$$';
 const other=current.replace('new','old').replace('= 2','= 1').replace('x^2','x^3');
 const result=highlight(current,other,'added');
 assert.deepEqual(result.marks,['new']);
 const code=nodes(result.tree).filter(node=>node.tagName==='code');
 assert.ok(code.some(node=>text(node).includes('const answer = 2;')));
 assert.ok(code.some(node=>text(node).includes('x^2')));
 assert.ok(code.every(node=>!nodes(node).some(child=>child.tagName==='span')));
});

test('format-only and link target changes preserve markup without inventing text changes',()=>{
 const result=highlight('**same** [label](https://example.org/new)','same [label](https://example.org/old)','added');
 assert.deepEqual(result.marks,[]);
 assert.ok(nodes(result.tree).some(node=>node.tagName==='strong'));
 assert.ok(nodes(result.tree).some(node=>node.tagName==='a'&&node.properties?.href==='https://example.org/new'));
});

test('comparison shares the preview sanitizer and cannot add executable source markup',()=>{
 const result=highlight('new <img src="x" onerror="alert(1)"><script>bad()</script>','old','added');
 assert.ok(!nodes(result.tree).some(node=>node.tagName==='script'));
 assert.ok(nodes(result.tree).every(node=>!Object.keys(node.properties??{}).some(key=>/^on/i.test(key))));
});

test('very large replacements use block color without expanding a character diff',()=>{
 const result=highlight('new '.repeat(4000),'old '.repeat(4000),'added');
 assert.deepEqual(result.marks,[]);
});

test('fragment footnote IDs, links and accessible labels stay in their own scope',()=>{
 const tree=previewComparisonTree('Text[^note].\n\n[^note]: Footnote.');
 scopedPreviewIds('old-block-')()(tree);
 const all=nodes(tree),ids=new Set(all.flatMap(node=>typeof node.properties?.id==='string'?[node.properties.id]:[]));
 assert.ok(ids.size>0);
 assert.ok([...ids].every(id=>id.startsWith('old-block-')));
 for(const node of all){
  const href=node.properties?.href;
  if(typeof href==='string'&&href.startsWith('#'))assert.ok(ids.has(href.slice(1)),href);
  const describedBy=node.properties?.ariaDescribedBy;
  if(Array.isArray(describedBy))assert.ok(describedBy.every(id=>ids.has(String(id))));
 }
});
