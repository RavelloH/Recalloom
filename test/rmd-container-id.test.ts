import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual,serializeRmdBlock} from '../web/src/rmd-serialize';
import {getRmdSchema} from '../web/src/rmd-schema';
import {withoutBlockIdentity} from '../web/src/tiptap/editor-block-actions';

const examples:Record<string,string>={
 note:'A note.',
 warning:'Warning text.',
 mark:'Marked content.',
 highlight:'Highlighted content.',
 circle:'Circle content.',
 tabs:'::: tab One\n\nTab content.\n\n:::',
 chat:'::: message Agent | sender=assistant\n\nReply.\n\n:::',
 flashcard:'::: front\n\nQuestion?\n\n:::\n\n::: back\n\nAnswer.\n\n:::',
 glossary:'::: definition Flux\n\nContent.\n\n:::',
 details:'More details.'
};
describe('stable RMD container IDs through visual/source roundtrip',()=>{
 for(const [kind,content] of Object.entries(examples)){
  it('preserves '+kind+' id through visual parsing and canonical RMD serialization',()=>{
   const title=['note','warning','tabs','chat','details'].includes(kind)?' Sample':'';
   const input=':::: '+kind+title+' | id=stable-'+kind+'\n\n'+content+'\n\n::::';
   const parsed=parseRmdVisual(input);
   assert.equal(parsed.content?.length,1,'one '+kind+' block');
   const container=parsed.content?.[0];
   assert.equal(container?.type,'richContainer');
   assert.equal(container.attrs?.kind,kind);
   assert.equal(container.attrs?.id,'stable-'+kind);
   const serialized=serializeRmdVisual(parsed);
   assert.match(serialized,new RegExp('id=stable-'+kind));
   const next=parseRmdVisual(serialized);
   assert.equal(next.content?.[0]?.attrs?.id,'stable-'+kind);
   const cleaned=withoutBlockIdentity(container);
   assert.equal(cleaned.attrs?.id,null,'duplicated block cannot repeat stable anchor');
  });
 }
 it('never serializes stable ID on block kinds whose schema forbids it',()=>{
  for(const kind of ['message','tab','front','back','definition']){
   assert.ok(!('id' in (getRmdSchema('block',kind)?.attributes??{})));
   const source=serializeRmdBlock({type:'richContainer',attrs:{kind,id:'invalid-identity',title:'Child'},
    content:[{type:'paragraph',content:[{type:'text',text:'Child'}]}]});
   assert.doesNotMatch(source,/\bid=/);
  }
 });
});