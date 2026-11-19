/** Feed editorial timeline and feedback: isolated local Worker + mocked, attributable Agent items. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {readLocalAuthVars} from './local-auth-config.mjs';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use isolated E2E runner');
const secret=readLocalAuthVars().match(/^\s*MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const executablePath=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));
const browser=await chromium.launch({headless:true,executablePath});
const context=await browser.newContext({viewport:{width:1365,height:900},timezoneId:'Asia/Shanghai'});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{if(response.status()>=500)errors.push('HTTP '+response.status()+' '+response.url());});

const now=Date.now();
const stamp=hours=>new Date(now-hours*3600000).toISOString();
const news=[
 ['release','一个需要保持长标题完整可读的开源检索框架发布消息：增量索引与语义召回性能获得改进','这次版本修正了增量索引过程中的多项边界行为，批处理及任务重试也得到了优化。'.repeat(3),'与 Recalloom 正在进行的索引性能研究有关。','https://github.com/example/release',2,1,2,1],
 ['news','Cloudflare 更新 Workers AI 文档和模型调用说明','新增的资料可能帮助核对当前的推理调用和免费额度。','可能影响当前项目的部署策略。','https://developers.cloudflare.com/workers-ai/',1,0,1,3],
 ['insight','研究 Agent 发现项目中可以优化的索引边界','对现有分块和索引策略提出了一个经过初步验证的建议。','建议跟现有研究文档对比。',null,1,0,1,5],
 ['alert','监控 Agent 发现一项需要关注的项目变化','一个源于监控任务的变化，等待进一步核验。','与最近的项目里程碑有关。','https://example.org/alert',1,0,1,27],
 ['digest','本周开发工具和项目动态精选','本周值得关注的研究主题与工具更新汇总。','可作为下一阶段改进计划的参考。','https://example.org/digest',1,0,1,30]
];
const items=news.map(([kind,title,summary,whyRelevant,primaryUrl,sourceCount,readRevision,revision,hours],index)=>({
 id:'d8f00000-0000-4000-8000-'+String(index+1).padStart(12,'0'),
 kind,title,summary,whyRelevant,primaryUrl,sourceCount,revision,agentName:'GitHub Agent',sourcePublisher:'Example publisher',
 firstSeenAt:stamp(hours),lastChangedAt:stamp(hours-0.1),publishedAt:stamp(hours+1),
 expiresAt:null,lifecycle:'active',
 state:{readRevision,savedAt:null,dismissedAt:null,snoozedUntil:null,feedback:null}
}));
const actions=[];
await page.route('**/api/feed**',async route=>{
 const request=route.request(),url=new URL(request.url()),method=request.method();
 const match=/^\/api\/feed\/([\da-f-]+)(?:\/state)?$/.exec(url.pathname);
 if(url.pathname==='/api/feed'&&method==='GET'){
  const view=url.searchParams.get('view')??'inbox',kind=url.searchParams.get('kind'),query=(url.searchParams.get('query')??'').toLowerCase();
  const filtered=items.filter(item=>{
   if(kind&&item.kind!==kind)return false;
   if(query&&!item.title.toLowerCase().includes(query)&&!item.summary.toLowerCase().includes(query))return false;
   if(view==='unread')return item.state.readRevision<item.revision&&!item.state.dismissedAt&&!item.state.snoozedUntil;
   if(view==='saved')return Boolean(item.state.savedAt);
   if(view==='later')return Boolean(item.state.snoozedUntil);
   if(view==='dismissed')return Boolean(item.state.dismissedAt);
   if(view==='inbox')return !item.state.dismissedAt&&!item.state.snoozedUntil;
   return true;
  });
  await route.fulfill({json:{items:filtered,page:{nextCursor:null}}});return;
 }
 const item=items.find(entry=>entry.id===match?.[1]);
 if(!item){await route.fulfill({status:404,json:{error:'Not found'}});return;}
 const detail=()=>({...item,observations:[{
  id:'o1',itemId:item.id,actor:'grant:github',actorName:'GitHub Agent',sourceKind:'github',
  sourceUrl:item.primaryUrl,publisher:'Example publisher',evidenceExcerpt:'发布说明包含增量索引改进。',
  observedAt:item.firstSeenAt,sourcePublishedAt:item.publishedAt
 },...(item.sourceCount>1?[{
  id:'o2',itemId:item.id,actor:'grant:research',actorName:'Research Agent',sourceKind:'web',
  sourceUrl:'https://example.org/source',publisher:'Review',evidenceExcerpt:'另一来源补充了升级兼容性。',
  observedAt:item.firstSeenAt,sourcePublishedAt:item.publishedAt
 }]:[])],relations:[]});
 if(method==='GET'){await route.fulfill({json:{item:detail()}});return;}
 if(method==='POST'&&url.pathname.endsWith('/state')){
  const input=request.postDataJSON();actions.push({id:item.id,...input});
  const state=item.state,stampNow=new Date().toISOString();
  if(input.action==='read')state.readRevision=item.revision;
  if(input.action==='unread')state.readRevision=0;
  if(input.action==='save')state.savedAt=stampNow;
  if(input.action==='unsave')state.savedAt=null;
  if(input.action==='dismiss')state.dismissedAt=stampNow;
  if(input.action==='restore')state.dismissedAt=null;
  if(input.action==='snooze')state.snoozedUntil=input.until;
  if(input.action==='unsnooze')state.snoozedUntil=null;
  if(input.action==='feedback')state.feedback=input.value==='clear'?null:input.value;
  await route.fulfill({json:{item:detail()}});return;
 }
 await route.fulfill({status:405,json:{error:'Not allowed'}});
});
const artifacts='tmp/feed-ui-e2e';mkdirSync(artifacts,{recursive:true});
async function checkGeometry(width){
 await page.setViewportSize({width,height:840});
 await page.waitForTimeout(260);
 const info=await page.evaluate(()=>{
  const width=innerWidth;
  const bounds=selector=>[...document.querySelectorAll(selector)].filter(el=>getComputedStyle(el).display!=='none').map(el=>{
   const r=el.getBoundingClientRect();return {x:r.left,right:r.right,width:r.width,height:r.height};
  });
  const cards=bounds('.feed-story'),title=bounds('.feed-story-open'),actions=bounds('.feed-story-actions button');
  return {width,scrollWidth:document.documentElement.scrollWidth,cards,title,actions,
   filter:bounds('.feed-views')[0],kind:bounds('.feed-kind-picker')[0],search:bounds('.workspace-toolbar-search')[0]};
 });
 assert.ok(info.scrollWidth<=width+1,'Page must not overflow at '+width+': '+JSON.stringify(info));
 for(const card of info.cards)assert.ok(card.x>=-2&&card.right<=width+2,'Card must remain in viewport at '+width+': '+JSON.stringify(card));
 for(const target of info.actions){
  const minimum=width<=720?40:28;
  assert.ok(target.width>=minimum&&target.height>=minimum,'Quick actions must remain tappable at '+width+': '+JSON.stringify(target));
 }
 assert.ok(info.cards.length===items.length,'All cards appear at '+width);
 await page.screenshot({path:artifacts+'/feed-'+width+'.png',fullPage:true});
 return info;
}
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 await page.goto(base+'/feed');
 await page.getByRole('heading',{name:'信息流',level:1}).waitFor();
 assert.equal(await page.locator('.feed-story').count(),5);
 assert.equal(await page.locator('.feed-day').count(),2,'Calendar groups have today and yesterday');
 assert.equal(await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button').count(),5);
 assert.equal(await page.getByRole('button',{name:'动态',exact:true}).getAttribute('aria-pressed'),'true');
 assert.ok(await page.locator('.feed-story[data-unread]').count()>=3);
 await checkGeometry(1365);
 await page.getByRole('textbox',{name:'搜索动态'}).fill('Cloudflare');
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===1);
 await page.getByRole('textbox',{name:'搜索动态'}).fill('没有任何匹配的测试关键词');
 await page.getByRole('button',{name:'清除筛选条件'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===5);
 await page.getByRole('combobox',{name:'动态类型'}).click();
 await page.getByRole('option',{name:'重要提醒',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===1);
 await page.getByRole('combobox',{name:'动态类型'}).click();
 await page.getByRole('option',{name:'全部类型',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===5);
 await page.locator('.feed-story').first().getByRole('button',{name:/一个需要保持长标题/}).click();
 await page.locator('[data-feed-detail]').waitFor();
 assert.equal(await page.locator('.feed-detail-source').count(),2,'All original sources remain visible');
 await page.getByRole('button',{name:'有帮助'}).click();
 await page.waitForFunction(()=>document.querySelector('.feed-detail-feedback button')?.getAttribute('data-variant')==='secondary');
 assert.ok(actions.some(action=>action.action==='feedback'&&action.value==='helpful'),'Feedback actually reaches the API');
 await page.getByRole('button',{name:'关闭'}).click();
 await page.locator('.feed-story').first().getByRole('button',{name:'收藏动态'}).click();
 await page.waitForFunction(()=>document.querySelector('.feed-story [aria-label="取消收藏"]')!==null);
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'收藏'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===1);
 await page.locator('.feed-story').getByRole('button',{name:'24 小时后再看'}).click();
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'稍后'}).click();
 await page.locator('.feed-story').getByRole('button',{name:'取消稍后阅读'}).waitFor();
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'动态',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===4);
 // Restore the snoozed test entry to exercise five-card responsive layouts.
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'稍后'}).click();
 await page.locator('.feed-story').getByRole('button',{name:'取消稍后阅读'}).click();
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'动态',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feed-story').length===5);
 for(const width of [320,390,430,820]){
  const layout=await checkGeometry(width);
  console.log('Feed layout PASS width='+width+', cards='+layout.cards.length+', minAction='+Math.min(...layout.actions.map(a=>a.width)).toFixed(1));
 }
 await page.setViewportSize({width:320,height:844});
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'已忽略'}).click();
 await page.getByText('没有已忽略的动态').waitFor();
 await page.getByRole('navigation',{name:'信息流视图'}).getByRole('button',{name:'动态',exact:true}).click();
 await page.locator('.feed-story').first().waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({colorScheme:'dark'});
 await page.reload();
 await page.locator('.feed-story-open').first().waitFor();
 const contrast=await page.evaluate(()=>{
  const title=getComputedStyle(document.querySelector('.feed-story-open')).color;
  const background=getComputedStyle(document.querySelector('.feed-story')).backgroundColor;
  const channels=color=>(color.match(/[0-9.]+/g)??[]).slice(0,3).map(Number).map(value=>{
   const relative=value/255;return relative<=.04045?relative/12.92:((relative+.055)/1.055)**2.4;
  });
  const luminance=color=>{const [r,g,b]=channels(color);return .2126*r+.7152*g+.0722*b;};
  const lighter=Math.max(luminance(title),luminance(background));
  const darker=Math.min(luminance(title),luminance(background));
  return {title,background,ratio:(lighter+.05)/(darker+.05)};
 });
 assert.ok(contrast.ratio>=4.5,'Dark-theme title contrast must be at least 4.5:1: '+JSON.stringify(contrast));
 await page.screenshot({path:artifacts+'/feed-dark-390.png',fullPage:true});
 assert.deepEqual(errors,[],'No browser JavaScript errors or 5xx responses');
 console.log('Feed UI PASS: editorial grouping, source details, feedback, save, snooze, 320–1365px and dark scheme');
}finally{
 await browser.close();
}
