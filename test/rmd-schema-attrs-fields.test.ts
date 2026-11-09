import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {RMD_REGISTRY} from '../web/src/rmd-schema';
import {
 rmdAttrNodeMapping,isRmdAttrsEditable,pmAttrKey,
 rmdAttributeDefinition,normalizeRmdAttribute
} from '../web/src/tiptap/rmd-schema-attrs-model';

describe('shared Schema-driven block attributes',()=>{
 it('covers every RMD @ attrs node without an extra hand-maintained field list',()=>{
  assert.deepEqual(Object.values(rmdAttrNodeMapping).map(x=>x.node).sort(),
   RMD_REGISTRY.nodes.map(x=>x.node).sort());
  assert.deepEqual(Object.keys(rmdAttrNodeMapping).sort(),
   ['heading','paragraph','blockMath','table','codeBlock','image'].sort());
  for(const kind of Object.keys(rmdAttrNodeMapping)){
   assert.ok(isRmdAttrsEditable(kind));
   assert.ok(rmdAttributeDefinition(kind));
  }
  assert.equal(isRmdAttrsEditable('richContainer'),false);
 });
 it('maps stable IDs and code filename to their correct ProseMirror keys',()=>{
  assert.equal(pmAttrKey('id',rmdAttrNodeMapping.paragraph!),'blockId');
  assert.equal(pmAttrKey('id',rmdAttrNodeMapping.image!),'figureId');
  assert.equal(pmAttrKey('id',rmdAttrNodeMapping.blockMath!),'equationId');
  assert.equal(pmAttrKey('id',rmdAttrNodeMapping.table!),'tableId');
  assert.equal(pmAttrKey('file',rmdAttrNodeMapping.codeBlock!),'filename');
 });
 it('validates stable reference IDs and required namespace prefixes',()=>{
  assert.deepEqual(normalizeRmdAttribute('heading','id','  Chapter-One  '),{ok:true,value:'chapter-one'});
  assert.equal(normalizeRmdAttribute('heading','id','9bad').ok,false);
  assert.equal(normalizeRmdAttribute('paragraph','id','a'.repeat(81)).ok,false);
  assert.equal(normalizeRmdAttribute('image','id','fig-device').ok,true);
  assert.equal(normalizeRmdAttribute('image','id','unprefixed').ok,false);
  assert.equal(normalizeRmdAttribute('blockMath','id','eq-power').ok,true);
  assert.equal(normalizeRmdAttribute('blockMath','id','fig-device').ok,false);
  assert.equal(normalizeRmdAttribute('table','id','tbl-power').ok,true);
  assert.equal(normalizeRmdAttribute('table','id','eq-power').ok,false);
  assert.deepEqual(normalizeRmdAttribute('heading','id',' '),{ok:true,value:null});
 });
 it('enforces dimension limits, string bounds and boolean values',()=>{
  assert.deepEqual(normalizeRmdAttribute('image','width','480'),{ok:true,value:480});
  assert.deepEqual(normalizeRmdAttribute('image','height',''),{ok:true,value:null});
  for(const invalid of ['39','1801','12.5','-1','Infinity'])
   assert.equal(normalizeRmdAttribute('image','width',invalid).ok,false,invalid);
  assert.equal(normalizeRmdAttribute('image','caption','x'.repeat(241)).ok,false);
  assert.equal(normalizeRmdAttribute('table','caption','first\nsecond').ok,false);
  assert.deepEqual(normalizeRmdAttribute('codeBlock','wrap','true'),{ok:true,value:true});
  assert.deepEqual(normalizeRmdAttribute('codeBlock','expand','false'),{ok:true,value:false});
  assert.equal(normalizeRmdAttribute('heading','caption','x').ok,false);
 });
});