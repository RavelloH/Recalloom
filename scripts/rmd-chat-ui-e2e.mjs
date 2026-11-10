import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8815';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Chat UI tests must use an isolated localhost worker');
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(browserPath,'Local Edge/Chrome required');
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.ok(secret,'Local test secret required');
const source=[
 '# Chat UI regression',
 '',
 ':::: chat 项目讨论',
 '',
 '::: message 用户 | sender=user',
 '',
 '你好！请检查 **Callout** 和聊天组件。',
 '',
 ':::',
 '',
 '::: message Assistant | sender=assistant',
 '',
 '这是一个比较长的助手回复，包含 Markdown 正文、加粗和列表，目的是验证内容宽度、气泡间距、编辑能力与移动端断行。',
 '',
 '- 第一项',
 '- 第二项',
 '',
 ':::',
 '',
 '::: message 系统 | sender=system',
 '',
 '会话已存档。',
 '',
 ':::',
 '',
 '::: message 用户 | sender=user',
 '',
 '谢谢。',
 '',
 ':::',
 '',
 '::::',
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const dest='tmp/chat-audit/screens';fs.mkdirSync(dest,{recursive:true});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Chat UI local regression '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },source);
 assert.equal(created.status,201,JSON.stringify(created).slice(0,250));
 const id=created.data.id;
 const snapshots={};
 for(const theme of ['light','dark']){
  await page.evaluate(t=>localStorage.setItem('recalloom:mode',t),theme);
  for(const size of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844},{name:'narrow',width:320,height:720}]){
   await page.setViewportSize({width:size.width,height:size.height});
   for(const mode of ['preview','visual']){
    await page.goto(base+'/records/'+id+'?mode='+mode);
    const root=page.locator(mode==='preview'?'.markdown-preview':'.tiptap');
    await root.waitFor();
    const log=root.getByRole('log').first();await log.waitFor();
    await log.locator('article').first().waitFor();
    const values=await log.evaluate(el=>{
     const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
     const style=n=>{const s=getComputedStyle(n);return {font:s.fontSize,line:s.lineHeight,radius:s.borderRadius,bg:s.backgroundColor,padding:s.padding,maxWidth:s.maxWidth,gap:s.gap}};
     const rows=[...el.querySelectorAll('article')].map(node=>{
      const bubble=node.querySelector('.astryx-chat-message-bubble');
      const head=node.querySelector('[data-chat-name]');
      const avatar=node.querySelector('[role="img"]');
      return {
       sender:node.getAttribute('data-sender'),
       density:node.getAttribute('data-density'),
       variant:bubble?.getAttribute('data-variant'),
       avatar:avatar?rect(avatar):null,
       rect:rect(node),
       bubble:bubble?{...rect(bubble),...style(bubble)}:null,
       head:head?{...rect(head),...style(head)}:null,
       text:bubble?.textContent?.trim().slice(0,85),
      };
     });
     const section=el.closest('.rk-chat-embed');
     const wrapper=el.closest('.rk-directive-chat');
     const inner=el.querySelector('.rk-chat-list');
     return {log:rect(el),section:section?{...rect(section),...style(section)}:null,
       heading:section?.querySelector('.rk-chat-embed-title')?.textContent??'',
       rows,inner:inner?style(inner):null,
       messageMargins:wrapper?[...wrapper.querySelectorAll('.rk-directive-message')].map(n=>getComputedStyle(n).margin):[],
       overflow:el.scrollWidth>el.clientWidth+1,
       documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
     };
    });
    assert.equal(values.rows.length,4,theme+' '+size.name+' '+mode+' message count');
    assert.deepEqual(values.rows.map(v=>v.sender),['user','assistant','system','user']);
    assert.deepEqual(values.rows.map(v=>v.density),['compact','compact','compact','compact'],'explicit compact density');
    assert.deepEqual(values.rows.map(v=>v.variant),['filled','filled','ghost','filled'],'users and agents use filled bubbles; system stays unobtrusive');
    assert.ok(values.rows.every(v=>!v.avatar),'static RMD chat has no avatars');
    assert.ok(values.rows.every(v=>v.head&&v.head.font==='12px'),'speaker names use a consistent 12px label');
    assert.ok(values.rows.every(v=>v.bubble.y-v.head.y-v.head.h>=2),'speaker name has a visible gap above its bubble: '+JSON.stringify(values.rows.map(v=>({sender:v.sender,gap:v.bubble.y-v.head.y-v.head.h}))));
    assert.ok(values.rows.every(v=>v.sender==='user' ? Math.abs(v.head.x+v.head.w-v.bubble.x-v.bubble.w)<1.5 : v.sender==='assistant'?Math.abs(v.head.x-v.bubble.x)<1.5:true),'speaker names align with bubble edges');
    assert.ok(values.rows.every(v=>v.bubble?.w<=v.rect.w+1),'no bubble larger than message column');
    assert.ok(values.rows.every(v=>v.bubble?.font==='14px'),'native 14px body font');
    assert.ok(values.section.w<=721,'chat transcript must respect the document prose width: '+JSON.stringify(values.section));
    assert.equal(values.overflow,false,'no transcript horizontal overflow');
    assert.equal(values.documentOverflow,false,'no document horizontal overflow');
    assert.ok(values.heading.includes('项目讨论'),'RMD chat title is rendered');
    if(mode==='visual'){
     assert.ok(values.messageMargins.every(m=>m==='0px'),'NodeViews must not add duplicate margins: '+values.messageMargins.join(','));
     assert.ok(Math.abs(parseFloat(values.inner.gap)-8)<.1,'editor content should use compact message gap');
     assert.ok(await page.locator('.rk-chat-message p').first().evaluate(n=>n.isContentEditable),'chat body remains editable');
    }
    snapshots[theme+'-'+size.name+'-'+mode]=values;
    if(size.name!=='narrow')await page.screenshot({path:dest+'/regression-'+theme+'-'+size.name+'-'+mode+'.png',fullPage:true});
   }
   const preview=snapshots[theme+'-'+size.name+'-preview'],visual=snapshots[theme+'-'+size.name+'-visual'];
   for(let i=0;i<4;i++){
    const a=preview.rows[i],b=visual.rows[i];
    assert.equal(a.bubble.radius,b.bubble.radius,'bubble radius parity: '+theme+' '+size.name+' '+i);
    assert.equal(a.bubble.line,b.bubble.line,'bubble line height parity');
    assert.equal(a.bubble.padding,b.bubble.padding,'bubble padding parity');
    assert.ok(Math.abs(a.bubble.w-b.bubble.w)<=5,'bubble width parity: '+JSON.stringify({i,a:a.bubble.w,b:b.bubble.w}));
     assert.ok(Math.abs(a.head.w-b.head.w)<2,'speaker labels must not shift when a hidden Tiptap edit button is mounted');
   }
  }
 }
 await page.setViewportSize({width:1280,height:900});
 await page.goto(base+'/records/'+id+'?mode=visual');
 const editChatTitle=page.locator('.rk-chat-embed-title .rk-directive-title-hit').first();
 await editChatTitle.waitFor({state:'attached'});
 await editChatTitle.click();
 const titleInput=page.getByRole('textbox',{name:'容器标题'}).first();
 await titleInput.waitFor();
 await titleInput.fill('项目讨论（已编辑）');
 await titleInput.press('Enter');
 await page.locator('.rk-chat-embed-title').getByText('项目讨论（已编辑）').waitFor();
 assert.equal(await page.locator('.rk-chat-transcript article').count(),4,'editing chat title does not remount or drop messages');
 const assistant=page.locator('.rk-directive-message').filter({has:page.locator('article[data-sender="assistant"]')}).first();
 await assistant.locator('.rk-directive-title-hit').click();
 const speakerInput=assistant.getByRole('textbox',{name:'容器标题'});
 await speakerInput.waitFor();
 await speakerInput.fill('Agent A');
 await speakerInput.press('Enter');
 await assistant.locator('[data-chat-name]').getByText('Agent A').waitFor();
 await assistant.locator('.rk-directive-title-hit').click();
 const cancellable=assistant.getByRole('textbox',{name:'容器标题'});
 await cancellable.fill('不应被保存的临时名字');
 await cancellable.press('Escape');
 await assistant.locator('[data-chat-name]').getByText('Agent A').waitFor();
 assert.equal(await assistant.locator('[data-chat-name]').getByText('不应被保存的临时名字').count(),0,'Escape cancels instead of persisting title edits');
 assert.match(await assistant.locator('.rk-chat-bubble').innerText(),/助手回复|回复/,'editing speaker name retains message body');
 assert.equal(await page.locator('.rk-directive-title button').count(),0,'no pencil icon is required to edit structural titles');
 assert.deepEqual(errors,[],'no browser JS errors');
 console.log('PASS RMD CHAT UI',JSON.stringify({
  senderRoles:'4 messages, no avatars, native compact density, agent bubbles filled, names aligned',
  modes:'preview and Tiptap visual matched',
  themes:'light/dark',
  widths:'1280/390/320 without overflow',
  desktopBubbles:snapshots['light-desktop-preview'].rows.map(v=>({sender:v.sender,width:v.bubble.w,height:v.bubble.h})),
  mobileBubbles:snapshots['dark-mobile-preview'].rows.map(v=>({sender:v.sender,width:v.bubble.w,height:v.bubble.h})),
  editable:true,
 }));
}finally{await browser.close();}
