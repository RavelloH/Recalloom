import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserPath&&line,'Local Edge and .dev.vars required');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const content=[
 '# Notion-style rich editor behavior',
 '',
 '::::flashcard[架构问题]',
 '',
 ':::front[问题]',
 '',
 'QA_FRONT：Recalloom 的内容格式是什么？',
 '',
 ':::',
 '',
 ':::back[答案]',
 '',
 'QA_BACK：**Markdown**，并支持 :cloze[QA_CLOZE_ANSWER]{hint="点击揭示"}。',
 '',
 ':::',
 '',
 '::::',
 '',
 '::::tabs',
 '',
 ':::tab[概览]',
 '',
 'QA_TAB_FIRST 第一个面板中的**粗体**内容。',
 '',
 ':::',
 '',
 ':::tab[源码]',
 '',
 'QA_TAB_SECOND 第二个面板中的列表。',
 '',
 '- 可编辑',
 '- 不应丢失',
 '',
 ':::',
 '',
 '::::',
 '',
 ':::details[可折叠内容]',
 '',
 'QA_DETAILS_CONTENT 这里有一些可编辑的文字。',
 '',
 ':::',
 '',
 '可见批注：%%QA_COMMENT_ALWAYS_VISIBLE%%。',
 ''
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:1380,height:920}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded',timeout:25000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:20000});
 const created=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Notion visual editor QA '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },content);
 assert.equal(created.status,201,JSON.stringify(created).slice(0,300));
 await page.goto(origin+'/records/'+created.data.id,{waitUntil:'domcontentloaded',timeout:25000});
 const surface=page.locator('.tiptap');
 await surface.waitFor();
 const flash=surface.locator('[data-rk-kind="flashcard"]').first();
 const back=flash.locator('[data-rk-kind="back"]').first();
 const question=flash.locator('[data-rk-kind="front"]').first();
 const cloze=flash.locator('.rk-inline-cloze').first();
 const tabs=surface.locator('[data-rk-kind="tabs"]').first();
 const details=surface.locator('[data-rk-kind="details"]').first();
 const tabPanels=tabs.locator('[data-rk-kind="tab"]');
 await flash.waitFor();
 assert.equal(await tabPanels.count(),2);
 assert.ok(await question.isVisible(),'Flashcard question must show');
 assert.equal(await back.isVisible(),false,'Flashcard answer should start concealed inside actual editor');
 assert.equal(await cloze.count(),1,'Cloze must be present even when answer hidden');
 assert.ok(await surface.getByText('QA_COMMENT_ALWAYS_VISIBLE').isVisible(),'Comment should never be hidden');
 const flashOpen=flash.getByRole('button',{name:'显示答案',exact:true});
 await flashOpen.click();
 assert.equal(await back.isVisible(),true,'Flashcard button must reveal editable answer in visual editor');
 const clozeAnswer=cloze.locator('.rk-cloze-editor-answer').first();
 assert.equal(await clozeAnswer.isVisible(),false,'Nested Cloze should initially be concealed');
 const clozeButton=cloze.locator('button.rk-cloze-trigger').first();
 assert.equal(await clozeButton.getAttribute('aria-expanded'),'false');
 await clozeButton.click();
 assert.equal(await clozeButton.getAttribute('aria-expanded'),'true');
 assert.ok(await clozeAnswer.isVisible(),'Cloze answer must be revealable in the real editor');
 assert.equal(await clozeAnswer.textContent(),'QA_CLOZE_ANSWER');
 assert.equal(await clozeAnswer.evaluate(el=>el.isContentEditable),true,'revealed answer must remain editable');
 await clozeButton.click();
 assert.equal(await clozeAnswer.isVisible(),false);
 await clozeButton.click();
 assert.equal(await clozeAnswer.isVisible(),true);
 const tabsDom=await tabs.evaluate(el=>{
  const body=el.querySelector('.rk-tabs-editor-body');
  return {tabCount:body?.children.length,markup:body?.innerHTML.slice(0,800),active:el.querySelector('.rk-tabs-edit')?.getAttribute('data-rk-active-tab')};
 });
 assert.equal(tabsDom.active,'0');
 assert.equal(await tabPanels.nth(0).isVisible(),true,'First editor tab visible by default');
 assert.equal(await tabPanels.nth(1).isVisible(),false,'Inactive tab must actually be hidden in visual editor');
 await tabs.locator('button[data-tab-value="1"]').click();
 assert.equal(await tabPanels.nth(0).isVisible(),false,'Inactive tab must hide without unmount');
 assert.equal(await tabPanels.nth(1).isVisible(),true,'Selecting tab must reveal editable second panel');
 assert.ok((await tabPanels.nth(1).textContent())?.includes('QA_TAB_SECOND'));
 await tabs.locator('button[data-tab-value="0"]').click();
 assert.equal(await tabPanels.nth(0).isVisible(),true);
 assert.equal(await tabPanels.nth(1).isVisible(),false);
 const collapse=details.getByRole('button',{name:/可折叠内容/});
 await collapse.click();
 assert.equal(await details.getByText('QA_DETAILS_CONTENT').isVisible(),false);
 await collapse.click();
 assert.equal(await details.getByText('QA_DETAILS_CONTENT').isVisible(),true);
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'All interaction state changes must not mark Markdown dirty');
 const snapshot=await page.evaluate(async id=>await(await fetch('/api/records/'+id)).json(),created.data.id);
 assert.equal(snapshot.content,content,'UI interaction must leave source unchanged');
 // Actually edit the revealed Cloze and save. Control is not an inert preview.
 await clozeAnswer.fill('QA_CLOZE_EDITED');
 assert.ok(await page.getByRole('button',{name:'保存'}).isEnabled(),'Editing content must create real dirty state');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="保存"]')?.hasAttribute('disabled'),null,{timeout:15000});
 const saved=await page.evaluate(async id=>await(await fetch('/api/records/'+id)).json(),created.data.id);
 const normalized=saved.content.replaceAll('\\_','_');
 assert.ok(saved.content.includes(':cloze[QA_CLOZE_EDITED]{hint="点击揭示"}'),'Edited Cloze must serialize back into Markdown');
 assert.ok(normalized.includes('QA_TAB_FIRST')&&normalized.includes('QA_TAB_SECOND'),'Tabs must not lose hidden panels');
 assert.ok(normalized.includes('QA_COMMENT_ALWAYS_VISIBLE'),'Comment remains');
 // Reload the persisted Markdown: hidden data must remain editable after reparse.
 await page.reload({waitUntil:'domcontentloaded',timeout:20000});
 const reopened=page.locator('.tiptap');
 await reopened.waitFor({timeout:20000});
 const flashAgain=reopened.locator('[data-rk-kind="flashcard"]').first();
 const backAgain=flashAgain.locator('[data-rk-kind="back"]').first();
 assert.equal(await backAgain.isVisible(),false,'Reopened flashcard must start concealed');
 await flashAgain.getByRole('button',{name:'显示答案',exact:true}).click();
 assert.equal(await backAgain.isVisible(),true,'Reopened answer must be recoverable');
 const clozeAgain=flashAgain.locator('.rk-inline-cloze').first();
 await clozeAgain.locator('.rk-cloze-trigger').click();
 assert.equal(await clozeAgain.locator('.rk-cloze-editor-answer').textContent(),'QA_CLOZE_EDITED');
 const tabsAgain=reopened.locator('[data-rk-kind="tabs"]').first();
 await tabsAgain.locator('button[data-tab-value="1"]').click();
 assert.ok((await tabsAgain.locator('[data-rk-kind="tab"]').nth(1).textContent())?.includes('QA_TAB_SECOND'),
  'Inactive tab content must survive a saved reload');
 // Repeated toggles stress React NodeViews without creating ProseMirror transactions.
 for(let i=0;i<8;i++){
  await tabsAgain.locator('button[data-tab-value="0"]').click();
  await tabsAgain.locator('button[data-tab-value="1"]').click();
  await clozeAgain.locator('.rk-cloze-trigger').click();
  await clozeAgain.locator('.rk-cloze-trigger').click();
  await flashAgain.getByRole('button',{name:'收起答案',exact:true}).click();
  await flashAgain.getByRole('button',{name:'显示答案',exact:true}).click();
 }
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),
  'Repeated interactive state changes must never create a new Markdown revision');

 assert.deepEqual(errors,[]);
 console.log('PASS Notion visual editor: flashcard and Cloze reveal/edit, tabs switch, details collapse, no phantom saves or data loss');
}finally{await browser.close().catch(()=>{});}
