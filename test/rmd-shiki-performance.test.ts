import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Schema} from '@tiptap/pm/model';
import {EditorState,Plugin,PluginKey} from '@tiptap/pm/state';
import {DecorationSet} from '@tiptap/pm/view';
import {codeHighlightMayChange,optimizeShikiPlugins} from '../web/src/tiptap/shiki-transaction';

const schema=new Schema({nodes:{
 doc:{content:'block+'},
 paragraph:{group:'block',content:'text*'},
 codeBlock:{group:'block',content:'text*',attrs:{language:{default:'ts'}}},
 text:{group:'inline'}
}});
const paragraph=(value:string)=>schema.node('paragraph',null,[schema.text(value)]);
const code=(value:string,language='ts')=>schema.node('codeBlock',{language},[schema.text(value)]);
const state=()=>EditorState.create({schema,doc:schema.node('doc',null,[paragraph('hello'),code('const a=1')])});

test('only changes touching code blocks require Shiki token re-highlighting',()=>{
 const s=state();
 assert.equal(codeHighlightMayChange(s.tr.insertText('X',2)),false);
 assert.equal(codeHighlightMayChange(s.tr.setSelection(s.selection)),false);
 assert.equal(codeHighlightMayChange(s.tr.insertText('X',s.doc.child(0).nodeSize+2)),true);
 assert.equal(codeHighlightMayChange(s.tr.setNodeMarkup(s.doc.child(0).nodeSize,undefined,{language:'python'})),true);
 assert.equal(codeHighlightMayChange(s.tr.delete(s.doc.child(0).nodeSize,s.doc.content.size)),true);
 assert.equal(codeHighlightMayChange(s.tr.insertText('A',2).insertText('B',3)),true);
});

test('upstream Shiki is preserved for code changes and explicit async theme refresh',()=>{
 let handled=0;
 const plugin=new Plugin<DecorationSet>({
  key:new PluginKey('shiki'),
  state:{init:()=>DecorationSet.empty,apply(_tr,current){handled++;return current;}}
 });
 const optimized=optimizeShikiPlugins([plugin])[0]!;
 assert.notEqual(optimized,plugin);
 const base=state();
 const active=EditorState.create({schema,doc:base.doc,plugins:[optimized]});
 const normal=active.apply(active.tr.insertText('x',2));
 assert.equal(handled,0,'normal typing should only map existing decorations');
 const codePos=normal.doc.child(0).nodeSize+2;
 const next=normal.apply(normal.tr.insertText('z',codePos));
 assert.equal(handled,1,'code typing must re-highlight using original tokenizer');
 next.apply(next.tr.setMeta('shikiPluginForceDecoration',true));
 assert.equal(handled,2,'async highlighter completion must still refresh colors');
});
