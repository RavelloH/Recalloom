import assert from 'node:assert/strict';
import test from 'node:test';
import {hydrateTaskEditor,taskEditorChanges,taskEditorDirty,taskEditorDraft,taskItemFromMutation} from '../web/src/tasks/editor-state.js';

const list={id:'list',name:'List',path:'/List',folderId:null,status:'active',revision:3,order:'manual' as const,counts:{todo:1,in_progress:0,blocked:0,done:0,cancelled:0},total:1};
const item=(details?:string,revision=3)=>({id:'task',recordId:'list',title:'Server title',details,status:'todo' as const,priority:0,position:0,updatedAt:'',list:{...list,revision}});

test('exact hydration preserves dirty metadata and only fills untouched details',()=>{
 const base=item(undefined,3),draft={...taskEditorDraft(base),title:'Local title'};
 const result=hydrateTaskEditor(base,draft,item('Remote details',4),{dirty:true,busy:false,detailsTouched:false});
 assert.equal(result.draft.title,'Local title');
 assert.equal(result.draft.details,'Remote details');
 assert.equal(result.base.list.revision,3);
});

test('exact hydration never overwrites details already edited locally',()=>{
 const base=item(undefined,3),draft={...taskEditorDraft(base),title:'Local title',details:'Local details'};
 const result=hydrateTaskEditor(base,draft,item('Remote details',4),{dirty:true,busy:false,detailsTouched:true});
 assert.equal(result.draft.details,'Local details');
 assert.equal(result.base.details,undefined);
});

test('metadata saves omit details until the exact value is available',()=>{
 const base=item(undefined),draft={...taskEditorDraft(base),title:'Renamed'};
 assert.deepEqual(taskEditorChanges(base,draft,false),{title:'Renamed'});
 assert.deepEqual(taskEditorChanges(item('Original'),{...draft,details:''},true),{title:'Renamed',details:''});
});

test('title whitespace normalization cannot leave a saveable empty change',()=>{
 const base=item('Details'),whitespace={...taskEditorDraft(base),title:'  Server title  '};
 assert.equal(taskEditorDirty(base,whitespace,true),false);
 assert.deepEqual(taskEditorChanges(base,whitespace,true),{});
 const renamed={...whitespace,title:'  Renamed  '};
 assert.equal(taskEditorDirty(base,renamed,true),true);
 assert.deepEqual(taskEditorChanges(base,renamed,true),{title:'Renamed'});
});

test('a successful create can seed its editor without an exact follow-up request',()=>{
 const tasks=[
  {id:'first',recordId:'list',title:'First',details:'',status:'done' as const,priority:0},
  {id:'created',recordId:'list',title:'Created',details:'Draft details',status:'todo' as const,priority:0}
 ];
 const created=taskItemFromMutation(tasks[1]!,tasks,list,4,'2026-11-15T00:00:00.000Z');
 assert.equal(created.recordId,'list');
 assert.equal(created.position,1);
 assert.equal(created.updatedAt,'2026-11-15T00:00:00.000Z');
 assert.equal(created.list.revision,4);
 assert.equal(created.list.total,2);
 assert.deepEqual(created.list.counts,{todo:1,in_progress:0,blocked:0,done:1,cancelled:0});
});

test('a successful update advances the editor seed to the mutation revision',()=>{
 const tasks=[
  {id:'task',recordId:'list',title:'Renamed',details:'Updated',status:'in_progress' as const,priority:0},
  {id:'second',recordId:'list',title:'Second',details:'',status:'todo' as const,priority:0}
 ];
 const saved=taskItemFromMutation(tasks[0]!,tasks,list,5,'2026-11-15T00:00:00.000Z');
 assert.equal(saved.title,'Renamed');
 assert.equal(saved.details,'Updated');
 assert.equal(saved.position,0);
 assert.equal(saved.list.revision,5);
 assert.deepEqual(saved.list.counts,{todo:1,in_progress:1,blocked:0,done:0,cancelled:0});
});
