import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const browserPath=[process.env.CHROMIUM_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const authLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserPath&&authLine,'Local browser and auth secret required');
const secret=authLine.slice(authLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const source=[
 '# 闪卡富文本测试',
 '',
 '在软件里按 :kbd[Ctrl+Shift+P] 调出搜索。',
 '',
 '::::flashcard[知识测验]',
 '',
 ':::front[问题]',
 '',
 'QA_FLASHCARD_QUESTION：Recalloom 的 Markdown 源码是否权威？',
 '',
 ':::',
 '',
 ':::back[答案]',
 '',
 'QA_FLASHCARD_ANSWER：是的，**源码始终权威**。这里还有 :cloze[版本号]{hint="点击揭示"}。',
 '',
 '- 所有内容都可编辑',
 '- 展开状态不进入 Markdown',
 '',
 ':::',
 '',
 '::::',
 '',
 '~~~markdown',
 ':kbd[This is only code]',
 '::::flashcard[这是代码围栏，不是闪卡]',
 '~~~'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:1366,height:930}});
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
const post=async(path,body)=>page.evaluate(async({path,body})=>{
 const response=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
},{path,body});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:26000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:19000});
 const note=await post('/records',{name:'Flashcard semantics '+Date.now()+'.md',kind:'document',content:source});
 assert.equal(note.status,201,JSON.stringify(note));
 await page.goto(base+'/records/'+note.body.id,{waitUntil:'domcontentloaded',timeout:23000});
 await page.locator('.tiptap [data-rk-kind="flashcard"]').waitFor({timeout:23000});
 assert.equal(await page.locator('.tiptap [data-rk-kind="front"]').count(),1);
 assert.equal(await page.locator('.tiptap [data-rk-kind="back"]').count(),1);
 assert.equal(await page.locator('.tiptap .rk-keycap').count(),1,'one editable inline keycap');
 assert.equal(await page.locator('.tiptap .rk-inline-cloze').count(),1,'one editable cloze node');
 assert.equal(await page.locator('.tiptap .rk-keycap').textContent(),'Ctrl+Shift+P');
 assert.ok((await page.locator('.tiptap').textContent())?.includes('QA_FLASHCARD_ANSWER'),'answer should remain mounted in visual editor');
 assert.equal(await page.locator('.tiptap [data-rk-kind="flashcard"] .rk-flashcard-back').count(),1);
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'opening a flashcard must not create unsaved state');
 const recordBefore=await page.evaluate(async id=>await(await fetch('/api/records/'+id)).json(),note.body.id);
 assert.equal(recordBefore.content,source,'opening the visual editor cannot modify canonical Markdown');
 const embed='{{embed:id:'+note.body.id+'}}';
 const preview=await post('/records',{name:'Flashcard read-only preview '+Date.now()+'.md',kind:'document',content:'# Preview\n\n'+embed});
 assert.equal(preview.status,201,JSON.stringify(preview));
 await page.goto(base+'/records/'+preview.body.id,{waitUntil:'domcontentloaded',timeout:23000});
 const card=page.locator('.rk-flashcard-read').first();
 await card.waitFor({timeout:25000});
 assert.ok((await card.textContent())?.includes('QA_FLASHCARD_QUESTION'));
 const button=card.getByRole('button',{name:/显示答案/});
 await button.waitFor({timeout:13000});
 const answer=card.getByText(/QA_FLASHCARD_ANSWER/);
 assert.equal(await answer.isVisible(),false,'read-only answer should start collapsed');
 await button.click();
 await answer.waitFor({state:'visible',timeout:14000});
 const cloze=card.locator('.rk-cloze-reveal');
 await cloze.waitFor({timeout:13000});
 assert.ok(!(await cloze.textContent())?.includes('版本号'),'Cloze answer starts hidden only in readonly transclusion');
 await cloze.click();
 assert.equal(await cloze.getAttribute('aria-expanded'),'true','Cloze answer must report expanded state');
 assert.ok((await cloze.textContent())?.includes('版本号'),'Cloze reveal should show original answer');
 await cloze.click();
 assert.equal(await cloze.getAttribute('aria-expanded'),'false','Cloze hidden answer must report collapsed state');
 assert.ok(!(await cloze.textContent())?.includes('版本号'),'Cloze can be concealed again without editing Markdown');
 assert.ok((await card.textContent())?.includes('源码始终权威'));
 assert.equal(await card.locator('.rk-keycap').count(),0,'kbd is outside the card; card contents must remain separate');
 const keycap=page.locator('.markdown-preview .rk-keycap').first();
 await keycap.waitFor({timeout:12000});
 assert.equal(await keycap.textContent(),'Ctrl+Shift+P');
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'showing flashcard answer must not change Markdown');
 console.log('FLASHCARD_PASS',JSON.stringify({
  originalRevision:recordBefore.revision,
  flashcards:await page.locator('.rk-flashcard-read').count(),
  keycaps:await page.locator('.markdown-preview .rk-keycap').count(),
  visibleAnswer:await answer.isVisible(),
  nodeErrors:pageErrors.length
 }));
 assert.deepEqual(pageErrors,[]);
}finally{await browser.close().catch(()=>{});}
