import {readLocalAuthVars} from './local-auth-config.mjs';
/** Activity aggregates, Astryx chart interactions and independent panels on isolated Worker/D1. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use the isolated E2E harness');
const engine=process.env.RECALLOOM_E2E_BROWSER==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync):undefined;
const secretLine=readLocalAuthVars().split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'light'}),page=await context.newPage();
page.setDefaultTimeout(20000);
const faults=[];page.on('pageerror',error=>faults.push(error.message));
let sessionCookie='',holdDetail=false,releaseDetail,chartAgentFixture=false;
const namedAgents=[{actorKey:'client:ChatGPT',actorName:'ChatGPT'},{actorKey:'client:Codex',actorName:'Codex'},{actorKey:'client:Muse',actorName:'Muse'}];
const held=new Promise(resolve=>{releaseDetail=resolve;});
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(holdDetail&&/^\/api\/activity\/\d+$/.test(url.pathname))await held;
 // Backend tests verify OAuth aggregation against SQLite; this response fixture
 // checks how multiple named series render through the public Astryx chart API.
 if(chartAgentFixture&&url.pathname==='/api/activity/summary'){
  const response=await route.fetch({headers:{...await request.allHeaders(),...(sessionCookie?{cookie:sessionCookie}:{})}}),summary=await response.json();
  summary.agents=namedAgents;
  const last=summary.days.at(-1);last.agents=Object.fromEntries(namedAgents.map((agent,index)=>[agent.actorKey,index+1]));
  last.agent=6;last.total+=6;summary.contributions.agent=6;summary.totals.changes+=6;
  await route.fulfill({response,json:summary});return;
 }
 if(engine!=='webkit'){await route.continue();return;}
 if(url.pathname==='/api/auth/login'){
  const response=await route.fetch();sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});return;
 }
 if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...await request.allHeaders(),cookie:sessionCookie}})});return;}
 await route.continue();
});
const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{
 const response=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(path+' '+response.status+' '+JSON.stringify(data));return data;
},{path,body,method});
async function select(label,option){
 await page.locator('.activity-toolbar').scrollIntoViewIfNeeded();
 await page.getByRole('combobox',{name:new RegExp('^'+label)}).click();
 await page.getByRole('option',{name:option,exact:true}).click();
}
async function noOverflow(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');}
const artifacts='tmp/activity-analytics-'+engine;mkdirSync(artifacts,{recursive:true});
let stage='login';
page.on('crash',()=>console.error('Activity page process crashed at',stage));
try{
 await page.goto(base+'/login');await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
 const suffix=Date.now().toString(36),name='活动图表验收-'+suffix;
 const folder=await api('/folders',{name:'活动验收-'+suffix,parentId:null});
 const doc=await api('/records',{name:name+'.md',kind:'document',folderId:folder.id,content:'# Before'});
 for(let revision=1;revision<=3;revision++)await api('/records/'+doc.id+'/content',{expectedRevision:revision,content:'# Revision '+(revision+1)},'PATCH');
 const list=await api('/records',{name:name+'-任务',kind:'task_list',folderId:folder.id});
 const created=await api('/tasks/mutate',{recordId:list.id,expectedRevision:1,action:'add',changes:{title:'Activity task'}});
 const taskId=created.taskId??(await api('/tasks?recordId='+list.id)).items[0].id;
 await api('/tasks/mutate',{recordId:list.id,expectedRevision:2,action:'update',taskId,changes:{status:'done'}});
 await page.goto(base+'/activity');
 stage='chart and grouped feed';
 await page.locator('[data-activity-metric="completed"] strong').filter({hasText:'1'}).waitFor();
 const chart=page.locator('.activity-chart-canvas');await chart.getByRole('img').waitFor();
 assert.ok(await chart.getByRole('list',{name:'图例'}).count(),'Uses Astryx legend');
 assert.ok(await chart.locator('svg path').count()>0,'Astryx renders real data marks');
 await page.getByRole('textbox',{name:'搜索活动',exact:true}).fill(name);
 await page.waitForFunction(()=>document.querySelector('.activity-date-heading span')?.textContent==='7 条记录');
 const group=page.locator('.activity-group').filter({hasText:'连续修改 3 次'});await group.waitFor();
 assert.equal(await group.locator('.activity-description').first().innerText(),'连续修改 3 次 · 记录 · R1 → R4');
 const expand=group.getByRole('button',{name:'展开 3 条修改记录',exact:true});await expand.click();
 await group.locator('.activity-group-events .activity-row').nth(2).waitFor();
 assert.equal(await group.locator('.activity-group-events .activity-row').count(),3);
 for(const description of await group.locator('.activity-group-events .activity-description').allTextContents())assert.match(description,/^更新 · 记录 · R[234]$/);
 await group.getByRole('button',{name:'收起修改记录',exact:true}).click();
 await group.locator('.activity-group-events').waitFor({state:'hidden'});

 // The library's scale-driven click changes the feed, not the overall period metrics.
 const plot=chart.locator('svg').first(),bounds=await plot.boundingBox();
 await plot.click({position:{x:bounds.width-20,y:85}});
 await page.getByRole('button',{name:/\d{4}-\d{2}-\d{2} · 清除/}).waitFor();
 await page.getByRole('button',{name:/\d{4}-\d{2}-\d{2} · 清除/}).click();

 holdDetail=true;
 stage='detail panels and revision comparison';
 await group.locator('.activity-event-card').first().click({position:{x:12,y:20}});
 const panel=page.getByRole('complementary',{name:'活动详情',exact:true});await panel.waitFor();
 await panel.getByText('正在读取位置…',{exact:true}).waitFor();
 assert.ok((await panel.innerText()).includes('R4'),'Seeded revision renders before the detail fetch');
 assert.ok(await panel.getByRole('button',{name:'比较修改',exact:true}).isVisible(),'Compare action is available before loading detail');
 holdDetail=false;releaseDetail();await panel.getByText('/活动验收-'+suffix+'/'+name+'.md',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'比较修改',exact:true}).click();
 const comparison=page.getByRole('dialog',{name:'版本对比',exact:true});await comparison.waitFor();
 await comparison.getByRole('button',{name:'关闭版本对比',exact:true}).click();await comparison.waitFor({state:'hidden'});
 // A second event gets its own panel and preserves the first one's state.
 await page.locator('.activity-group').filter({hasText:'连续修改 2 次'}).locator('.activity-event-card').first().click({position:{x:12,y:20}});
 await page.waitForFunction(()=>document.querySelectorAll('[data-workspace-panel^="activity-detail-"]').length===2);
 assert.equal(await page.getByRole('complementary',{name:'活动详情',exact:true}).count(),2);
 await noOverflow();await page.screenshot({path:artifacts+'/desktop-light.png'});
 for(const close of await page.getByRole('complementary',{name:'活动详情',exact:true}).getByRole('button',{name:'关闭',exact:true}).all())await close.click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-workspace-panel^="activity-detail-"]').length===0);
 stage='dark theme reload';
 await page.evaluate(()=>{localStorage.setItem('recalloom:mode','dark');});await page.reload();
 await chart.getByRole('img').waitFor();await noOverflow();await page.screenshot({path:artifacts+'/desktop-dark.png'});
 stage='mobile layout and filters';
 // Start this capture at the target viewport; Windows WebKit's native
 // shrink crash is also reproducible with the pre-upgrade application.
 await page.goto('about:blank');await page.setViewportSize({width:390,height:844});await page.goto(base+'/activity');
 await chart.getByRole('img').waitFor();await noOverflow();
 assert.ok(await page.locator('.activity-chart-scroll').evaluate(element=>element.scrollWidth>element.clientWidth),'Chart scrolls inside its own region on mobile');
 await page.screenshot({path:artifacts+'/mobile-dark.png'});
 await page.locator('.activity-group').first().locator('.activity-event-card').first().click({position:{x:12,y:20}});
 const sheet=page.getByRole('dialog',{name:'活动详情',exact:true});await sheet.waitFor();
 assert.ok((await sheet.boundingBox()).width>=385);await sheet.getByRole('button',{name:'关闭',exact:true}).click();
 await sheet.waitFor({state:'hidden'});
 await select('时间范围','今天');await chart.getByRole('img').waitFor();
 await page.getByRole('button',{name:'更多筛选',exact:true}).click();
 await page.getByRole('button',{name:/^文件夹范围 /}).click();
 await page.getByRole('option',{name:'/活动验收-'+suffix,exact:true}).click();
 await noOverflow();
 // Pagination must not cap statistics at the first 50 originals.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.setViewportSize({width:1440,height:1000});
 stage='complete interval and pagination';
 const paginationName='活动分页-'+suffix;
 for(let start=0;start<61;start+=5)await Promise.all(Array.from({length:Math.min(5,61-start)},(_,offset)=>api('/records',{name:paginationName+'-'+(start+offset),kind:'document',folderId:folder.id,content:'Pagination'})));
 await page.getByRole('textbox',{name:'搜索活动',exact:true}).fill(paginationName);
 await page.waitForFunction(()=>document.querySelector('[data-activity-metric="changes"] strong')?.textContent==='61');
 await page.locator('.activity-load-more').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelectorAll('.activity-timeline [data-activity-seq]').length===61);
 await page.getByText('已显示所选范围内的全部活动',{exact:true}).waitFor();
 stage='task metadata second line';
 await api('/tasks/mutate',{recordId:list.id,expectedRevision:3,action:'update',taskId,changes:{title:'Updated activity task'}});
 await page.getByRole('textbox',{name:'搜索活动',exact:true}).fill(name+'-任务');
 const taskGroup=page.locator('.activity-group').filter({hasText:'连续修改 3 次'});await taskGroup.waitFor();
 await taskGroup.getByRole('button',{name:'展开 3 条修改记录',exact:true}).click();
 await taskGroup.locator('.activity-group-events .activity-description').filter({hasText:'修改 1 项任务 · 记录 · R4'}).waitFor();
 assert.equal(await page.locator('.activity-event-context,.activity-event-description').count(),0,'Event descriptions stay in the second metadata row');
 stage='named agent chart colors';
 chartAgentFixture=true;await page.reload();
 const legend=chart.getByRole('list',{name:'图例'});await legend.getByText('Muse',{exact:true}).waitFor();
 const swatches=[];
 for(const agent of namedAgents){
  const item=legend.getByRole('listitem').filter({hasText:agent.actorName});
  assert.equal(await item.count(),1,'Each named agent has its own legend entry');
  swatches.push(await item.locator('[aria-hidden="true"]').evaluate(element=>getComputedStyle(element).backgroundColor));
 }
 assert.equal(await legend.getByText('Agent',{exact:true}).count(),0,'No combined Agent series');
 assert.equal(new Set(swatches).size,namedAgents.length,'Named agents have distinct chart colors');
 const namedPlot=chart.locator('svg').first(),namedBounds=await namedPlot.boundingBox();
 await namedPlot.hover({position:{x:namedBounds.width-20,y:85}});
 for(const agent of namedAgents)await page.getByRole('tooltip').getByText(agent.actorName,{exact:true}).waitFor();
 await page.screenshot({path:artifacts+'/named-agents.png'});
 assert.deepEqual(faults,[],'No browser runtime errors');
 console.log('PASS Astryx named chart series/colors, real activity aggregates, second-line metadata, daily filtering, grouping, independent panels, compare and mobile themes:',engine,artifacts);
}catch(error){console.error('ACTIVITY FAILURE at',stage,error);await page.screenshot({path:artifacts+'/failure.png',fullPage:true}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>'(page unavailable)'),faults);throw error;}
finally{releaseDetail();await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
