import test from 'node:test';
import assert from 'node:assert/strict';
import {searchMarkdownText} from '../src/search-markdown.js';
import {searchExcerpt} from '../src/search-excerpt.js';
import {paragraphChunks,paragraphChunkSpans} from '../src/search-ranking.js';

test('Markdown summaries retain visible labels, technical identifiers and formula expressions',()=>{
 const source='# **检索说明**\n\n[官方指南](https://example.com/very/long/path) 与 `C++ C# foo_bar *ptr x < y`。\n\n公式 $P=UI$ 和 $x_1^2+\\alpha$。\n\n![结构图](https://example.com/image.png)';
 const text=searchMarkdownText(source);
 for(const value of ['检索说明','官方指南','C++ C# foo_bar *ptr x < y','P=UI','x_1^2+\\alpha','结构图'])assert.ok(text.includes(value),value);
 for(const marker of ['https://','**','![','$'])assert.equal(text.includes(marker),false,marker);
});

test('RMD controls and Wiki UUIDs disappear while labels, captions and chat senders remain',()=>{
 const id='52aaf89d-6cd3-4bac-80e1-1df863d199ff';
 const source=`::: details 参数说明 | open=true\n\n:: badge 稳定版 | info ::\n:: mark **重要** $P=UI$ ::\n[[id:${id}|模型研究]]\n::: chat 测试会话\n::: message 用户甲 | role=user\n请保留消息正文。\n:::\n:::\n:::\n\n| 项目 | 数值 |\n| --- | --- |\n| 电压 | 220 V |\n@ attrs table-one | caption="电气参数" @\n\n::: embed id:${id} :::\n::: link-card https://example.com | title=项目主页 :::`;
 const text=searchMarkdownText(source);
 for(const value of ['参数说明','稳定版','重要','P=UI','模型研究','用户甲','请保留消息正文','项目：电压','数值：220 V','电气参数','嵌入文稿','项目主页'])assert.ok(text.includes(value),value+'\n'+text);
 for(const marker of [':::',':: badge','open=true','role=user','@ attrs','table-one',id,'https://','| ---'])assert.equal(text.includes(marker),false,marker);
});

test('code and math protect literal Markdown, RMD, comments and Wiki expressions',()=>{
 const literal=':: badge value | info :: [[id:uuid]] %% literal %% **keep** @ attrs test @';
 const text=searchMarkdownText('```text\n'+literal+'\n```\n\n$$\nA_1 = B * C + \\alpha\n$$\n\n`**inline**`\n\n%% hidden comment %%');
 assert.ok(text.includes(literal));assert.ok(text.includes('A_1 = B * C + \\alpha'));assert.ok(text.includes('**inline**'));assert.equal(text.includes('hidden comment'),false);
});

test('task completion, deletion and footnote content retain their meaning',()=>{
 const text=searchMarkdownText('- [x] 已交付\n- [ ] 待处理\n\n~~旧方案~~ 改为新方案[^a]\n\n[^a]: 证据来源');
 for(const value of ['已完成：已交付','未完成：待处理','已删除：旧方案','证据来源'])assert.ok(text.includes(value),value);
 assert.equal(searchMarkdownText('[[unknown name]]'),'[[unknown name]]');
 assert.equal(searchMarkdownText(':: unknown 保留文本 ::'),':: unknown 保留文本 ::');
});

test('HTML entities and escaped Wiki table labels remain readable',()=>{
 assert.equal(searchMarkdownText('<div>A &amp; B &lt; C &#x1F600;</div>'),'A & B < C 😀');
 const table='| 名称 | 数值 |\n| --- | --- |\n| [[id:52aaf89d-6cd3-4bac-80e1-1df863d199ff\\|研究\\|附录]] | 512 |';
 const text=searchMarkdownText(table);
 assert.ok(text.includes('名称：研究|附录；数值：512'),text);
 assert.equal(searchMarkdownText('图注\n@ attrs | caption="$P=UI$" @'),'图注\nP=UI');
});

test('source spans preserve legacy chunks including trimmed Unicode and CRLF inputs',()=>{
 const input='  \r\n'+('😀 中文段落 **原文**\r\n\r\n'.repeat(160))+'  ';
 const spans=paragraphChunkSpans(input);
 assert.deepEqual(spans.map(span=>span.text),paragraphChunks(input));
 for(const span of spans)assert.equal(input.slice(span.start,span.end),span.text);
});

test('semantic excerpts retain symbols when a chunk starts inside a code fence',()=>{
 const content='# 实验\n\n```cpp\n'+Array.from({length:90},(_,i)=>`auto value_${i} = *ptr + C_1; // **literal**`).join('\n')+'\n```\n';
 const document={name:'code.md',content,revision:7};
 const chunks=paragraphChunks(document.name+'\n'+content);
 const excerpt=searchExcerpt('value_35',chunks[1]!,document,1);
 assert.ok(excerpt.snippet.includes('value_35 = *ptr + C_1; // **literal**'));
 assert.equal(excerpt.snippetFormat,'text');assert.ok(excerpt.lineStart!>1);
 const lines=content.split('\n').slice(excerpt.lineStart!-1,excerpt.lineEnd!);
 assert.ok(lines.join('\n').includes('value_35'));
 assert.ok(lines.join('\n').includes('```cpp'));
});

test('mid-table and math excerpts recover labels and source positions without reindexing',()=>{
 const table='| 参数 | 数值 |\n| --- | --- |\n'+Array.from({length:100},(_,i)=>`| PARAM_${i} | ${i} V |`).join('\n');
 const document={name:'table.md',content:table,revision:2};
 const chunks=paragraphChunks(document.name+'\n'+table);
 const excerpt=searchExcerpt('PARAM_60',chunks[1]!,document,1);
 assert.ok(excerpt.snippet.includes('参数：PARAM_60'),excerpt.snippet);
 assert.ok(excerpt.snippet.includes('数值：60 V'),excerpt.snippet);
 assert.equal(excerpt.lineStart,1,'The readable labels are included in the pinned source range');
 const math=searchExcerpt('A_40','',{name:'math.md',content:'$$\n'+Array.from({length:100},(_,i)=>'A_'+i+' = B_1 * C_2').join('\n')+'\n$$',revision:1});
 assert.ok(math.snippet.includes('A_40 = B_1 * C_2'));
});

test('CR-only source and display math with an opening-line expression preserve evidence',()=>{
 const content='标题\r\r$$ A_0 = B_1 * C_2\r'+Array.from({length:100},(_,i)=>'TERM_'+i+' = *A_1 * B_2').join('\r')+'\r$$';
 const document={name:'formula.md',content,revision:1};
 const chunks=paragraphChunks(document.name+'\n'+content);
 const index=chunks.findIndex(chunk=>chunk.includes('TERM_70'));
 const excerpt=searchExcerpt('TERM_70',chunks[index]!,document,index);
 assert.ok(excerpt.snippet.includes('TERM_70 = *A_1 * B_2'),excerpt.snippet);
 assert.equal(excerpt.lineStart,3);
});
