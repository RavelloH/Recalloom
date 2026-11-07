import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {RichContainer,RichBadge,RichAbbr,RichTip} from '../web/src/tiptap/rich-directives';
import {VisibleComment} from '../web/src/tiptap/comment-mark';
import {RichLinkCard} from '../web/src/tiptap/rich-link-card';
import {RichFrontMatter} from '../web/src/tiptap/rich-frontmatter';
import {frontMatterEntries} from '../web/src/tiptap/frontmatter-utils';
import {extractWikiSection} from '../web/src/wiki-section';
import {RichFootnoteRef,RichFootnoteDefinition} from '../web/src/tiptap/rich-footnotes';
import {RichCritic} from '../web/src/tiptap/rich-critic';
import {WikiLinkNode,WikiEmbedNode} from '../web/src/tiptap/wiki-nodes';
import {RawMarkdown} from '../web/src/tiptap/raw-markdown';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import type {JSONContent} from '@tiptap/core';

const manager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false}),
 CustomHeading,CustomParagraph,Markdown,RawMarkdown,RichContainer,WikiLinkNode,WikiEmbedNode,
 RichBadge,RichAbbr,RichTip,RichCritic,RichLinkCard,RichFrontMatter,RichFootnoteRef,RichFootnoteDefinition,VisibleComment,
]});
const walk=(n:JSONContent,cb:(item:JSONContent)=>void)=>{
 cb(n);for(const x of n.content??[])walk(x,cb);
};
const nodes=(doc:JSONContent,type:string)=>{
 const matches:JSONContent[]=[];walk(doc,n=>{if(n.type===type)matches.push(n);});return matches;
};
describe('Rich Markdown structural directives',()=>{
 it('turns warning into a rich editable container with markdown children and title',()=>{
  const source=['# Heading','',':::warning[安全提示]','','请先**备份**，再执行：','','- 核对环境','- 保存记录','',':::','','## End'].join('\n');
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'richContainer').length,1);
  const directive=nodes(doc,'richContainer')[0]!;
  assert.equal(directive.attrs?.kind,'warning');
  assert.equal(directive.attrs?.title,'安全提示');
  assert.equal(directive.content?.[0]?.type,'paragraph');
  assert.ok(JSON.stringify(directive).includes('"type":"bold"'));
  assert.ok(nodes(directive,'bulletList').length);
  const exported=manager.serialize(doc);
  assert.match(exported,/:::warning\[安全提示\]/);
  assert.match(exported,/\*\*备份\*\*/);
  assert.match(exported,/备份\*\*，再执行：\n\n- 核对环境/,'paragraph and list must remain distinct blocks');
  assert.match(exported,/:::\s*\n+## End/);
 });
 it('supports nested collapsible and warning containers without losing inner markdown',()=>{
  const doc=buildVisualMarkdown('::::details[细节]\n\n:::warning[请注意]\n\n正文 **强调**。\n\n:::\n\n::::',manager);
  const containers=nodes(doc,'richContainer');
  assert.equal(containers.length,2,JSON.stringify(doc));
  assert.equal(containers[0]?.attrs?.kind,'details');
  assert.equal(containers[1]?.attrs?.kind,'warning');
  assert.match(manager.serialize(doc),/::::details/);
 });
 it('preserves all five CriticMarkup review types without applying suggestions',()=>{
  const source='增加 {++推荐文字++}，删除 {--过时文字--}，替换 {~~老内容~>新内容~~}，标记 {==重点==}{>>Agent A：查证来源<<}。';
  const doc=buildVisualMarkdown(source,manager);
  const items=nodes(doc,'richCritic');
  assert.equal(items.length,5,JSON.stringify(doc));
  assert.deepEqual(items.map(x=>x.attrs?.kind),['addition','deletion','substitution','highlight','comment']);
  assert.equal(items[2]?.attrs?.before,'老内容');
  assert.equal(items[2]?.content?.[0]?.text,'新内容');
  const output=manager.serialize(doc);
  assert.ok(output.includes('{++推荐文字++}'));
  assert.ok(output.includes('{--过时文字--}'));
  assert.ok(output.includes('{~~老内容~>新内容~~}'));
  assert.ok(output.includes('{==重点==}{>>Agent A：查证来源<<}'));
  assert.equal(nodes(buildVisualMarkdown(output,manager),'richCritic').length,5);
 });
 it('keeps CriticMarkup inside code fences and inline code as literal code',()=>{
  const tick=String.fromCharCode(96);
  const source='正文 '+tick+'{++不是建议++}'+tick+'。\n\n~~~markdown\n{--仍是代码--}\n~~~';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'richCritic').length,0);
  assert.ok(manager.serialize(doc).includes('{--仍是代码--}'));
 });
 it('serializes nested tabs and preserves every editable panel and inline mark',()=>{
  const source=['::::tabs','',':::tab[预览]','','这是**第一项**。','',':::','',':::tab[源代码]','','这里是 `const x=1`。','',':::','','::::'].join('\n');
  const doc=buildVisualMarkdown(source,manager);
  const panels=nodes(doc,'richContainer');
  assert.equal(panels.length,3,JSON.stringify(doc));
  assert.equal(panels[0]?.attrs?.kind,'tabs');
  assert.equal(panels[1]?.attrs?.kind,'tab');
  assert.equal(panels[2]?.attrs?.kind,'tab');
  assert.ok(JSON.stringify(doc).includes('第一项'));
  assert.ok(JSON.stringify(doc).includes('const x=1'));
  const exported=manager.serialize(doc);
  assert.match(exported,/::::tabs/);
  assert.match(exported,/:::tab\[预览\]/);
  assert.match(exported,/:::tab\[源代码\]/);
  assert.match(exported,/\*\*第一项\*\*/);
  assert.match(exported,/`const x=1`/);
  assert.equal(nodes(buildVisualMarkdown(exported,manager),'richContainer').length,3);
 });
 it('renders multiple chat messages with sender metadata and nested editable markdown',()=>{
  const text=['::::chat','',':::message[Agent A]{sender=assistant}','','First **answer**.','',':::','',':::message[User]{sender=user}','','Second *reply*.','',':::','','::::'].join('\n');
  const doc=buildVisualMarkdown(text,manager);
  const boxes=nodes(doc,'richContainer');
  assert.equal(boxes.length,3,JSON.stringify(doc));
  assert.equal(boxes[0]?.attrs?.kind,'chat');
  assert.equal(boxes[1]?.attrs?.kind,'message');
  assert.equal(boxes[1]?.attrs?.sender,'assistant');
  assert.equal(boxes[2]?.attrs?.sender,'user');
  const output=manager.serialize(doc);
  assert.match(output,/:::message\[Agent A\]\{sender=assistant\}/);
  assert.match(output,/:::message\[User\]\{sender=user\}/);
  assert.match(output,/\*\*answer\*\*/);
  assert.match(output,/\*reply\*/);
 });
 it('turns link-card leaf directives into atomic editable nodes without adding metadata to Markdown',()=>{
  const source='## Useful links\n\n::link-card[项目]{url="https://github.com/RavelloH/Recalloom"}\n\n普通段落';
  const doc=buildVisualMarkdown(source,manager);
  const found=nodes(doc,'richLinkCard');
  assert.equal(found.length,1,JSON.stringify(doc));
  assert.equal(found[0]?.attrs?.url,'https://github.com/RavelloH/Recalloom');
  assert.equal(found[0]?.attrs?.title,'项目');
  const output=manager.serialize(doc);
  assert.match(output,/::link-card\[项目\]\{url="https:\/\/github.com\/RavelloH\/Recalloom"\}/);
  assert.ok(!output.includes('正在获取链接信息'));
  assert.equal(nodes(doc,'heading').length,1);
 });
 it('parses and preserves GFM footnote references and editable definition bodies',()=>{
  const source='这里有一条脚注[^qa-note]。\n\n[^qa-note]: **来源文献**和补充解释。';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'richFootnoteRef').length,1,JSON.stringify(doc));
  assert.equal(nodes(doc,'richFootnoteDefinition').length,1,JSON.stringify(doc));
  assert.equal(nodes(doc,'richFootnoteDefinition')[0]?.attrs?.id,'qa-note');
  assert.ok(JSON.stringify(doc).includes('来源文献'));
  const output=manager.serialize(doc);
  assert.match(output,/脚注\[\^qa-note\]/);
  assert.match(output,/\[\^qa-note\]: \*\*来源文献\*\*/);
 });
 it('retains nested list paragraphs in a GFM footnote definition',()=>{
  const source='正文[^list]\n\n[^list]: 说明\n\n    - 列表项\n    - 第二项';
  const doc=buildVisualMarkdown(source,manager);
  const note=nodes(doc,'richFootnoteDefinition')[0];
  assert.ok(note,JSON.stringify(doc));
  assert.equal(nodes(note,'bulletList').length,1);
  const output=manager.serialize(doc);
  assert.match(output,/\[\^list\]: 说明/);
  assert.match(output,/    - 列表项/);
 });
 it('parses stable heading IDs without displaying the {#id} label and writes them back',()=>{
  const original='## 实施过程 {#stable-process}\n\n详情\n\n### **复验** {#stable-review}';
  const doc=buildVisualMarkdown(original,manager);
  const headings=nodes(doc,'heading');
  assert.equal(headings.length,2);
  assert.equal(headings[0]?.attrs?.id,'stable-process');
  assert.equal(headings[1]?.attrs?.id,'stable-review');
  assert.equal(headings[0]?.content?.[0]?.text,'实施过程');
  assert.equal(headings[1]?.content?.[0]?.text,'复验');
  const output=manager.serialize(doc);
  assert.match(output,/## 实施过程 \{#stable-process\}/);
  assert.match(output,/### \*\*复验\*\* \{#stable-review\}/);
  assert.equal(nodes(buildVisualMarkdown(output,manager),'heading')[1]?.attrs?.id,'stable-review');
 });
 it('leaves malformed explicit heading anchors as normal Markdown text',()=>{
  const source='## Title {#bad/path}';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'heading')[0]?.attrs?.id??null,null);
  assert.ok(manager.serialize(doc).includes('bad/path'));
 });
 it('parses stable paragraph block references without exposing ^id in visible text',()=>{
  const input='这是一个**重要段落** ^key-result\n\n下一段不会绑定。';
  const doc=buildVisualMarkdown(input,manager);
  const paragraphs=nodes(doc,'paragraph');
  assert.equal(paragraphs[0]?.attrs?.blockId,'key-result');
  assert.equal(paragraphs[1]?.attrs?.blockId??null,null);
  assert.ok(!JSON.stringify(paragraphs[0]?.content).includes('^key-result'));
  const exported=manager.serialize(doc);
  assert.match(exported,/\*\*重要段落\*\* \^key-result/);
  assert.equal(nodes(buildVisualMarkdown(exported,manager),'paragraph')[0]?.attrs?.blockId,'key-result');
 });
 it('resolves a Wiki section by explicit heading id, old title, or paragraph ^block-id',()=>{
  const text=['# Intro','','Overview.','','## 稳定标题 {#stable-heading}','','本节正文。','','段落一。 ^referable-block','','## Next','','尾部内容。'].join('\n');
  assert.ok(extractWikiSection(text,'stable-heading').startsWith('## 稳定标题 {#stable-heading}'));
  assert.ok(extractWikiSection(text,'稳定标题').includes('本节正文。'));
  assert.ok(!extractWikiSection(text,'stable-heading').includes('尾部内容。'));
  assert.equal(extractWikiSection(text,'^referable-block'),'段落一。');
  assert.equal(extractWikiSection(text,'^does-not-exist'),'');
 });
 it('turns YAML Front Matter into Astryx metadata while preserving comments, arrays and source boundaries',()=>{
  const raw='---\ntitle: "My report"\ntags: [alpha, beta]\n# author note\nstatus: draft\n---';
  const doc=buildVisualMarkdown(raw+'\n\n# Heading\n\nText.',manager);
  assert.equal(nodes(doc,'richFrontMatter').length,1,JSON.stringify(doc));
  assert.equal(nodes(doc,'richFrontMatter')[0]?.attrs?.source,raw);
  assert.equal(nodes(doc,'heading').length,1);
  const values=frontMatterEntries(raw);
  assert.equal(values.error,null);
  assert.equal(values.entries.find(x=>x.key==='title')?.value,'My report');
  assert.equal(values.entries.find(x=>x.key==='tags')?.value,'alpha, beta');
  assert.ok(manager.serialize(doc).startsWith(raw));
 });
 it('never executes YAML tags/aliases and keeps unsafe or invalid YAML editable',()=>{
  const raw='---\nx: !<tag:yaml.org,2002:js/function> evil\n---';
  const doc=buildVisualMarkdown(raw+'\n\nParagraph',manager);
  assert.equal(nodes(doc,'richFrontMatter').length,1);
  assert.ok(manager.serialize(doc).includes(raw));
  assert.ok(frontMatterEntries(raw).error);
 });
 it('lets WikiLink and WikiEmbed take precedence over colon directives without creating raw paragraphs',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const source='Ref [[id:'+id+']] and [[id:'+id+'#stable|Section]].\n\n{{embed:id:'+id+'#stable}}';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(nodes(doc,'rawMarkdown').length,0,JSON.stringify(doc));
  assert.equal(nodes(doc,'wikiLink').length,2,JSON.stringify(doc));
  assert.equal(nodes(doc,'wikiEmbed').length,1,JSON.stringify(doc));
  const output=manager.serialize(doc);
  assert.ok(output.includes('[[id:'+id+']]'));
  assert.ok(output.includes('{{embed:id:'+id+'#stable}}'));
 });
 it('retains an unknown directive verbatim while keeping adjacent headings rich',()=>{
  const raw=':::future[不认识]\n\n内部内容\n\n:::';
  const doc=buildVisualMarkdown('# Before\n\n'+raw+'\n\n## After',manager);
  assert.equal(nodes(doc,'rawMarkdown').length,1);
  assert.ok(manager.serialize(doc).includes(raw));
  assert.equal(nodes(doc,'heading').length,2);
 });
 it('parses badges and nonambiguous inline abbreviations and tips',()=>{
  const sample='状态 :badge[已验证]{variant=success}。缩写 :abbr[DO]{title="Durable Objects"}，提示 :tip[阅读]{content="查看帮助"}。';
  const doc=buildVisualMarkdown(sample,manager);
  assert.equal(nodes(doc,'richBadge').length,1,JSON.stringify(doc));
  assert.equal(nodes(doc,'richAbbr').length,1);
  assert.equal(nodes(doc,'richTip').length,1);
  assert.equal(nodes(doc,'richAbbr')[0]?.attrs?.title,'Durable Objects');
  const exported=manager.serialize(doc);
  assert.ok(exported.includes(':abbr[DO]{title="Durable Objects"}'),exported);
 });
 it('marks comments as editable visible text and roundtrips literal content',()=>{
  const doc=buildVisualMarkdown('前文 %%这里是注释%% 后文',manager);
  const marked=nodes(doc,'text').filter(n=>n.marks?.some(m=>m.type==='visibleComment'));
  assert.equal(marked.length,1,JSON.stringify(doc));
  assert.equal(marked[0]?.text,'这里是注释');
  assert.ok(manager.serialize(doc).includes('%%这里是注释%%'));
 });
});
