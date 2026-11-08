import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {extractWikiReferences,parseWikiTarget} from '../src/wiki-syntax.js';
const ID='550e8400-e29b-41d4-a716-446655440000';
describe('stable Wiki references',()=>{
 it('accepts only UUID or absolute virtual paths; names are search-only',()=>{
  assert.deepEqual(parseWikiTarget('id:'+ID+'#Overview|说明'),{target:'id:'+ID,anchor:'Overview',alias:'说明'});
  assert.deepEqual(parseWikiTarget('/Projects/Recalloom/Note.md|笔记'),{target:'/Projects/Recalloom/Note.md',anchor:null,alias:'笔记'});
  assert.deepEqual(parseWikiTarget('id:'+ID+'#target-paragraph'),{target:'id:'+ID,anchor:'target-paragraph',alias:null});
  assert.equal(parseWikiTarget('id:'+ID+'#^target-paragraph'),null,'obsolete Obsidian caret anchor is invalid for both links and embeds');
  for(const bad of ['Note.md','folder/note.md','../note.md','/../note.md','/','id:invalid','/folder//note.md','#heading','/folder/a.md|'])
   assert.equal(parseWikiTarget(bad),null,bad);
 });
 it('preserves actual source offsets in CRLF documents',()=>{
  const src=['# 标题','段落 [[id:'+ID+']]。','另一段 [[id:'+ID+'|别名]]。'].join('\r\n');
  const refs=extractWikiReferences(src);
  assert.equal(refs.length,2,JSON.stringify(refs));
  const first=src.indexOf('[['),second=src.indexOf('[[',first+2);
  assert.deepEqual(refs.map(x=>x.offset),[first,second]);
 });
 it('indexes an unescaped Wiki alias within one GFM table cell, consistent with the visual parser',()=>{
  const input=['| 文档 | 引用 |','| --- | --- |','| 示例 | [[id:'+ID+'|可见别名]] |'].join('\n');
  const refs=extractWikiReferences(input);
  assert.equal(refs.length,1,JSON.stringify(refs));
  assert.equal(refs[0]?.alias,'可见别名');
  assert.equal(refs[0]?.offset,input.indexOf('[['));
  const quoted=input.replace('|可见别名',String.fromCharCode(92)+'|可见别名');
  assert.equal(extractWikiReferences(quoted)[0]?.alias,'可见别名');
 });
 it('extracts links and standalone embeds, but not code, math, markdown links or escapes',()=>{
  const tick=String.fromCharCode(96);
  const doc=[
   '# Head [[id:'+ID+'|Alias]]',
   '',
   'Here [[/Folder/A.md#Chapter]] and [[plain title]] stay literal.',
   '',
   '\\[[id:'+ID+']]',
   '',
   tick+'[[id:'+ID+']]'+tick,
   '',
   tick.repeat(3)+'md',
   '[[id:'+ID+']]',
   '::: embed id:'+ID+' :::',
   tick.repeat(3),
   '',
   '$[[id:'+ID+']]$',
   '',
   '[Regular [[id:'+ID+']]](https://example.org)',
   '',
   '::: embed /Folder/A.md#Chapter :::',
   '',
   'Paragraph ::: embed id:'+ID+' ::: should not auto-embed.'
  ].join('\n');
  const refs=extractWikiReferences(doc);
  assert.equal(refs.length,3,JSON.stringify(refs));
  assert.deepEqual(refs.map(r=>r.kind),['link','link','embed']);
  assert.deepEqual(refs.map(r=>r.target),['id:'+ID,'/Folder/A.md','/Folder/A.md']);
  assert.equal(refs[1]?.anchor,'Chapter');
  assert.equal(refs[2]?.anchor,'Chapter');
  assert.equal(refs[0]?.alias,'Alias');
  assert.ok(refs.every(r=>doc.slice(r.offset,r.offset+r.raw.length)===r.raw));
 });
});

describe('Wiki projections respect D1 parameter limits and identity pinning',()=>{
 it('resolves 180 distinct UUID targets with a single JSON parameter',async()=>{
  const {prepareWikiProjection,insertProjection}=await import('../src/wiki-references.js');
  const ids=Array.from({length:180},()=>crypto.randomUUID());
  const expressions=ids.map(id=>'[[id:'+id+']]').join(' ');
  let lookups=0;
  const db={
   prepare:(sql:string)=>({
    bind:(...params:unknown[])=>({
     all:async()=>{
      assert.ok(params.length<=1,'Never bind more than one parameter per projection lookup');
      if(sql.includes('FROM record_path_bindings'))return {results:[]};
      if(sql.includes('FROM records WHERE id IN')){
       lookups++;
       assert.equal(params.length,1);
       assert.equal((JSON.parse(String(params[0])) as string[]).length,180);
       return {results:ids.map(id=>({id}))};
      }
      throw Error('Unexpected SQL: '+sql);
     }
    })
   })
  };
  const {env}= {env:{DB:db} as unknown as import('../src/types.js').Env};
  const rows=await prepareWikiProjection(env,crypto.randomUUID(),expressions,2,async()=>{throw Error('UUIDs must not trigger path traversal');});
  assert.equal(lookups,1);
  assert.equal(rows.length,180);
  assert.ok(rows.every(row=>row.resolutionStatus==='resolved'));
  const statement=insertProjection(env,rows);
  assert.ok(statement,'Projection inserted via a single JSON-bound statement');
 });
 it('keeps stale path pins tombstoned instead of rebinding to a replacement',async()=>{
  const {prepareWikiProjection}=await import('../src/wiki-references.js');
  const surviving=crypto.randomUUID(),deleted=crypto.randomUUID();
  const paths=['/Old/Surviving.md','/Old/Deleted.md'];
  let externalResolutions=0;
  const db={
   prepare:(sql:string)=>({
    bind:(...args:unknown[])=>({
     all:async()=>{
      if(sql.includes('FROM record_path_bindings'))return {results:[
       {targetExpression:paths[0],targetId:surviving},
       {targetExpression:paths[1],targetId:deleted}
      ]};
      if(sql.includes('FROM records WHERE id IN')){
       assert.equal(args.length,1);
       assert.deepEqual(JSON.parse(String(args[0])).sort(),[surviving,deleted].sort());
       return {results:[{id:surviving}]};
      }
      throw Error('Unexpected SQL '+sql);
     }
    })
   })
  };
  const env={DB:db} as unknown as import('../src/types.js').Env;
  const rows=await prepareWikiProjection(env,crypto.randomUUID(),
   '[[/Old/Surviving.md]] and [[/Old/Deleted.md]]',4,async()=>{
    externalResolutions++;
    return {kind:'record',id:crypto.randomUUID()};
   });
  assert.equal(externalResolutions,0,'Pinned paths are never looked up again');
  assert.equal(rows[0]?.targetId,surviving);
  assert.equal(rows[1]?.targetId,null,'Removed target becomes missing instead of a dangling FK');
  assert.equal(rows[1]?.resolutionStatus,'missing');
 });
});
