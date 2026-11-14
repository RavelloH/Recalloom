import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {Schema} from '@tiptap/pm/model';
import {EditorState,type Plugin} from '@tiptap/pm/state';
import type {DecorationSet} from '@tiptap/pm/view';
import {RmdAttrsDecorations} from '../web/src/tiptap/rmd-attrs-decoration';

const schema=new Schema({nodes:{
 doc:{content:'block+'},text:{group:'inline'},
 paragraph:{group:'block',content:'text*'},
 table:{group:'block',content:'paragraph+',attrs:{tableId:{default:null},caption:{default:null}}},
 codeBlock:{group:'block',content:'text*',attrs:{id:{default:null},language:{default:null}}}
}});
function setup(){
 const table=schema.nodes.table.create({tableId:'tbl-test'},schema.nodes.paragraph.create(null,schema.text('Cell')));
 const code=schema.nodes.codeBlock.create({id:'code-test'},schema.text('before'));
 const plugins=RmdAttrsDecorations.config.addProseMirrorPlugins!.call(RmdAttrsDecorations as never) as Plugin<DecorationSet>[];
 const state=EditorState.create({schema,plugins,doc:schema.nodes.doc.create(null,[table,code])});
 return {state,plugin:plugins[0]!,table,code};
}
describe('Markdown attribute decoration boundaries',()=>{
 it('retains a table badge when typing inside the following code block',()=>{
  const {state,plugin,table}=setup();
  const next=state.apply(state.tr.insertText(' typed',table.nodeSize+4));
  const decorations=plugin.getState(next)!.find();
  assert.equal(decorations.length,2);
  assert.ok(decorations.some(item=>item.from===table.nodeSize));
 });
 it('retains a table badge when replacing its next sibling at the same boundary',()=>{
  const {state,plugin,table,code}=setup();
  assert.equal(plugin.getState(state)!.find().length,2);
  const next=state.apply(state.tr.replaceWith(table.nodeSize,table.nodeSize+code.nodeSize,code.type.create(code.attrs,schema.text('after longer'))));
  const decorations=plugin.getState(next)!.find();
  assert.equal(decorations.length,2);
  assert.ok(decorations.some(item=>item.from===table.nodeSize));
 });
 it('rebuilds the changed table badge without losing or duplicating its sibling',()=>{
  const {state,plugin,table}=setup();
  const next=state.apply(state.tr.setNodeMarkup(0,undefined,{...table.attrs,tableId:'tbl-renamed'}));
  const decorations=plugin.getState(next)!.find();
  assert.equal(decorations.length,2);
  assert.ok(decorations.some(item=>String(item.spec.key).includes('tbl-renamed')));
  assert.ok(!decorations.some(item=>String(item.spec.key).includes('tbl-test')));
 });
});
