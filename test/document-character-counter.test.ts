import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDocumentCharacterCounter,type DocumentCharacterCountReply,type DocumentCharacterCountWorker} from '../web/src/document-character-counter.js';
import {markdownCharacterCount} from '../web/src/document-heading.js';

class FakeWorker implements DocumentCharacterCountWorker{
 requests:{id:number;markdown:string}[]=[];
 terminated=false;
 errorPrevented=false;
 onMessage:((event:{data:DocumentCharacterCountReply})=>void)|null=null;
 onError:((event:{preventDefault:()=>void})=>void)|null=null;
 afterPost:((message:{id:number;markdown:string})=>void)|null=null;
 postMessage(message:{id:number;markdown:string}){this.requests.push(message);this.afterPost?.(message);}
 addEventListener(type:'message'|'error',listener:((event:{data:DocumentCharacterCountReply})=>void)|((event:unknown)=>void)){
  if(type==='message')this.onMessage=listener as (event:{data:DocumentCharacterCountReply})=>void;
  else this.onError=listener as (event:{preventDefault:()=>void})=>void;
 }
 terminate(){this.terminated=true;}
 reply(id:number,characters:number){this.onMessage?.({data:{id,characters}});}
 fail(){this.onError?.({preventDefault:()=>{this.errorPrevented=true;}});}
}

test('keeps one request in flight and replaces the pending source with the latest draft',()=>{
 const worker=new FakeWorker();
 const received:{markdown:string;characters:number}[]=[];
 const counter=createDocumentCharacterCounter((markdown,characters)=>received.push({markdown,characters}),{
  createWorker:()=>worker,count:markdownCharacterCount
 });
 counter.request('one');
 counter.request('two');
 counter.request('three');
 assert.deepEqual(worker.requests.map(request=>request.markdown),['one']);
 worker.reply(worker.requests[0].id,3);
 assert.deepEqual(received,[]);
 assert.deepEqual(worker.requests.map(request=>request.markdown),['one','three']);
 worker.reply(worker.requests[1].id,5);
 assert.deepEqual(received,[{markdown:'three',characters:5}]);
 counter.dispose();
});

test('accepts synchronous worker replies without losing the in-flight job',()=>{
 const worker=new FakeWorker();
 worker.afterPost=message=>worker.reply(message.id,markdownCharacterCount(message.markdown));
 const received:string[]=[];
 const counter=createDocumentCharacterCounter(markdown=>received.push(markdown),{createWorker:()=>worker});
 counter.request('first');
 counter.request('second');
 assert.deepEqual(worker.requests.map(request=>request.markdown),['first','second']);
 assert.deepEqual(received,['first','second']);
 counter.dispose();
});

test('ignores late replies after disposal and terminates its worker',()=>{
 const worker=new FakeWorker();
 const received:string[]=[];
 const counter=createDocumentCharacterCounter(markdown=>received.push(markdown),{createWorker:()=>worker});
 counter.request('pending');
 const id=worker.requests[0].id;
 counter.dispose();
 worker.reply(id,7);
 assert.equal(worker.terminated,true);
 assert.deepEqual(received,[]);
});

test('uses the parser fallback after worker construction failure',()=>{
 const counted:string[]=[];
 const received:{markdown:string;characters:number}[]=[];
 const counter=createDocumentCharacterCounter((markdown,characters)=>received.push({markdown,characters}),{
  createWorker:()=>{throw new Error('unavailable');},
  count:markdown=>{counted.push(markdown);return markdownCharacterCount(markdown);}
 });
 counter.request('# 你好');
 counter.request('**world**');
 assert.deepEqual(counted,['# 你好','**world**']);
 assert.deepEqual(received,[{markdown:'# 你好',characters:2},{markdown:'**world**',characters:5}]);
 counter.dispose();
});

test('falls back to the latest source after a worker runtime error',()=>{
 const worker=new FakeWorker();
 const counted:string[]=[];
 const received:{markdown:string;characters:number}[]=[];
 const counter=createDocumentCharacterCounter((markdown,characters)=>received.push({markdown,characters}),{
  createWorker:()=>worker,
  count:markdown=>{counted.push(markdown);return markdownCharacterCount(markdown);}
 });
 counter.request('first');
 counter.request('latest');
 worker.fail();
 assert.equal(worker.errorPrevented,true);
 assert.deepEqual(counted,['latest']);
 assert.deepEqual(received,[{markdown:'latest',characters:6}]);
 worker.reply(worker.requests[0].id,5);
 assert.deepEqual(received,[{markdown:'latest',characters:6}]);
 counter.request('after failure');
 assert.deepEqual(counted,['latest','after failure']);
 assert.deepEqual(received,[{markdown:'latest',characters:6},{markdown:'after failure',characters:12}]);
 counter.dispose();
});

test('uses the existing Markdown parser for Unicode and Markdown parity',()=>{
 const worker=new FakeWorker();
 const received:number[]=[];
 const source='# 你好 👩‍💻\n\n**text** and `code`';
 const counter=createDocumentCharacterCounter((_markdown,characters)=>received.push(characters),{createWorker:()=>worker});
 counter.request(source);
 const request=worker.requests[0];
 worker.reply(request.id,markdownCharacterCount(source));
 assert.deepEqual(received,[markdownCharacterCount(source)]);
 counter.dispose();
});
