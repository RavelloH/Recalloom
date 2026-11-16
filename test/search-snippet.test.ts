import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSnippet} from '../src/search-snippet.js';

test('snippets locate exact phrases beyond the old block prefix',()=>{
 const content='背景说明。'.repeat(100)+'\n恢复策略：EVIDENCE512 使用父章节恢复证据。\n'+'后续说明。'.repeat(80);
 const snippet=searchSnippet('EVIDENCE512',content);
 assert.ok(snippet.includes('EVIDENCE512 使用父章节恢复证据'));
 assert.ok(snippet.startsWith('…'));assert.ok(snippet.length<=350);
 const nearEnd=searchSnippet('EVIDENCE512','背景说明。'.repeat(100)+'\nEVIDENCE512 最终结论。');
 assert.ok(nearEnd.length<120,'An evidence window near the end does not pad itself with old boilerplate');
});

test('partial query matches prefer a window with more distinct terms',()=>{
 const content='索引。'.repeat(100)+'普通介绍。'.repeat(60)+'\n异步任务的租约过期后自动重试，并校验正文修订。\n'+'尾部。'.repeat(200);
 const snippet=searchSnippet('异步索引任务如何在租约过期后重试并校验正文修订？',content);
 assert.ok(snippet.includes('租约过期后自动重试'));
 assert.ok(snippet.includes('正文修订'));assert.ok(snippet.length<=350);
});

test('snippets preserve short inputs, safe fallbacks and Unicode boundaries',()=>{
 assert.equal(searchSnippet('anything','短文'),'短文');
 assert.equal(searchSnippet('anything',''),'');
 const content='😀'.repeat(300)+'target '+'😀'.repeat(300);
 const snippet=searchSnippet('target',content);
 assert.ok(snippet.includes('target'));assert.ok(snippet.length<=350);
 assert.equal(Buffer.from(snippet,'utf8').toString('utf8'),snippet);
 assert.ok(searchSnippet('missing','首段说明。'.repeat(100)).startsWith('首段说明'));
});
