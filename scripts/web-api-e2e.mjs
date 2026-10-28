import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {generateChallenge} from 'capjs-core';

const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const secret='recalloom-local-web-test-secret-32-bytes-only';
const key=createHmac('sha256',secret).update('recalloom:web:v1:cap').digest('hex');
const legacyDerivedCredential=createHmac('sha256',secret).update('recalloom:web:v1:login').digest('base64url');
const headers={'content-type':'application/json','origin':origin};
let cookie='';
async function api(path,opts={}){
  const r=await fetch(origin+path,{...opts,headers:{...headers,...(cookie?{'cookie':cookie}:{}),...opts.headers},redirect:'manual'});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text);}catch{data=text;}
  return {status:r.status,data,cookie:r.headers.get('set-cookie'),headers:r.headers};
}
function post(path,data,method='POST',extra={}){return api(path,{method,body:JSON.stringify(data),headers:extra});}
function assertStatus(result,status,label){assert.equal(result.status,status,label+': '+JSON.stringify(result.data));}
async function proof(){
  // Cheap V2 fixture uses the SAME production Cap.js validator and signing key.
  // Challenge issuance itself is also checked separately below.
  const c=await generateChallenge(key,{scope:'recalloom:web-login',format:2,protocols:['sha256-pow'],challengeCount:1,challengeDifficulty:1});
  const challenge=c.challenges[0].payload;
  let nonce=0;
  while(!createHash('sha256').update(challenge.salt+nonce).digest('hex').startsWith(challenge.target))nonce++;
  const body={token:c.token,solutions:[{nonce}]};
  const res=await post('/api/auth/cap/redeem',body);
  assertStatus(res,200,'redeem');
  assert.equal(res.data.success,true);
  return {token:res.data.token,body};
}
async function main(){
  const root=await api('/');
  assertStatus(root,200,'Worker root');
  if(typeof root.data==='string')assert.match(root.data,/Recalloom/,'SPA shell delivered');
  else assert.equal(root.data.name,'Recalloom');
  const unauth=await api('/api/folders');
  assertStatus(unauth,401,'unauthenticated request denied');
  const noOrigin=await api('/api/auth/cap/challenge',{method:'POST',headers:{origin:''}});
  assertStatus(noOrigin,403,'missing origin rejected');
  const wrongOrigin=await api('/api/auth/cap/challenge',{method:'POST',headers:{origin:'https://attacker.example'}});
  assertStatus(wrongOrigin,403,'CSRF origin rejected');
  const challenge=await post('/api/auth/cap/challenge',{});
  assertStatus(challenge,200,'production-strength Cap challenge issued');
  assert.equal(typeof challenge.data.token,'string');
  const badLogin=await post('/api/auth/login',{secret});
  assertStatus(badLogin,400,'login requires proof schema');
  const badProof=await post('/api/auth/login',{secret,capToken:'invalid'});
  assertStatus(badProof,403,'login requires Cap proof');
  const p1=await proof();
  const replay=await post('/api/auth/cap/redeem',p1.body);
  assertStatus(replay,403,'Cap nonce cannot replay');
  const badSecret=await post('/api/auth/login',{secret:'wrong',capToken:p1.token});
  assertStatus(badSecret,401,'bad secret denied');
  const usedProof=await post('/api/auth/login',{secret,capToken:p1.token});
  assertStatus(usedProof,403,'proof consumed even when secret wrong');
  const legacyProof=await proof();
  const legacyLogin=await post('/api/auth/login',{secret:legacyDerivedCredential,capToken:legacyProof.token});
  assertStatus(legacyLogin,401,'previous derived Web credential must not be accepted as a password');
  const p2=await proof();
  const simultaneous=await Promise.all([
    post('/api/auth/login',{secret,capToken:p2.token}),
    post('/api/auth/login',{secret,capToken:p2.token})
  ]);
  assert.deepEqual(simultaneous.map(x=>x.status).sort(),[200,403],'concurrent proof must only create one session');
  const good=simultaneous.find(x=>x.status===200);
  assertStatus(good,200,'login');
  assert.equal(good.data.authenticated,true);
  assert.match(good.cookie,/__Host-recalloom_session=[\w-]+/);
  assert.match(good.cookie,/HttpOnly/);
  assert.match(good.cookie,/Secure/);
  assert.match(good.cookie,/SameSite=Strict/);
  cookie=good.cookie.split(';')[0];
  const session=await api('/api/auth/session');
  assertStatus(session,200,'session protected');
  const sessionId=session.data.session.id;
  // Explicitly test cross-origin mutation with an actual HTTP request.
  const cross=await api('/api/folders',{method:'POST',body:JSON.stringify({name:'intruder'}),headers:{origin:'https://attacker.test'}});
  assertStatus(cross,403,'authenticated CSRF mutation rejected');
  const folder=await post('/api/folders',{name:'api-e2e-'+crypto.randomUUID(),description:'Web API test folder'});
  assertStatus(folder,201,'create folder');
  const folderId=folder.data.id;
  const folderInfo=await api('/api/folders/'+folderId);
  assertStatus(folderInfo,200,'folder details');
  assert.equal(folderInfo.data.id,folderId);
  const list=await api('/api/folders?parentId='+folderId);
  assertStatus(list,200,'browse');
  const record=await post('/api/records',{name:'checkpoint.md',kind:'checkpoint',folderId,content:'# Web checkpoint\nInitial state'});
  assertStatus(record,201,'create record');
  const id=record.data.id;
  const read=await api('/api/records/'+id);
  assertStatus(read,200,'read record');
  assert.equal(read.data.revision,1);
  const edit=await post('/api/records/'+id+'/content',{expectedRevision:1,content:'# Web checkpoint\nUpdated state'},'PATCH');
  assertStatus(edit,200,'edit record');
  assert.equal(edit.data.revision,2);
  const stale=await post('/api/records/'+id+'/content',{expectedRevision:1,content:'stale overwrite'},'PATCH');
  assertStatus(stale,409,'conflict protected');
  const tagged=await post('/api/records/'+id+'/tags',{action:'add',tag:'web-api-test'});
  assertStatus(tagged,200,'tag record');
  const meta=await post('/api/records/'+id+'/meta',{expectedMetadataRevision:1,description:'Updated via web'},'PATCH');
  assertStatus(meta,200,'metadata CAS');
  const oldMeta=await post('/api/records/'+id+'/meta',{expectedMetadataRevision:1,description:'stale'},'PATCH');
  assertStatus(oldMeta,409,'metadata conflict');
  const versions=await api('/api/records/'+id+'/versions');
  assertStatus(versions,200,'version history');
  assert.equal(versions.data.items.length,2);
  const diff=await api('/api/records/'+id+'/diff?from=1&to=2');
  assertStatus(diff,200,'revision diff');
  assert.equal(diff.data.changed,true);
  const taskList=await post('/api/records',{name:'Task list',kind:'task_list',folderId});
  assertStatus(taskList,201,'create task_list');
  const task=await post('/api/tasks/mutate',{action:'add',recordId:taskList.data.id,expectedRevision:1,changes:{title:'Build UI',priority:6,status:'todo'}});
  assertStatus(task,200,'mutate task');
  const tasks=await api('/api/tasks?recordId='+taskList.data.id);
  assertStatus(tasks,200,'list tasks');
  assert.equal(tasks.data.items.length,1);
  const search=await api('/api/search?mode=literal&query=Updated%20state');
  assertStatus(search,200,'search');
  assert.ok(search.data.items.find(x=>x.id===id));
  let eventCursor=0,foundActor=false;
  for(let page=0;page<25&&!foundActor;page++){
    const activity=await api('/api/activity?limit=200&cursor='+eventCursor);
    assertStatus(activity,200,'activity');
    foundActor=activity.data.items.some(e=>e.actor==='web:owner:'+sessionId);
    if(!activity.data.page.hasMore)break;
    eventCursor=activity.data.page.nextCursor;
  }
  assert.ok(foundActor,'Web API writes should carry session actor in change events');
  const links=await post('/api/records/'+id+'/links',{action:'add',targetId:taskList.data.id,relation:'tracks_tasks'});
  assertStatus(links,200,'link');
  const restore=await post('/api/records/'+id+'/restore',{targetRevision:1,expectedRevision:2});
  assertStatus(restore,200,'historical restore');
  const reread=await api('/api/records/'+id);
  assert.equal(reread.data.content,'# Web checkpoint\nInitial state');
  const sessions=await api('/api/auth/sessions');
  assertStatus(sessions,200,'list sessions');
  assert.ok(sessions.data.items.find(s=>s.id===sessionId));
  const revoked=await api('/api/auth/sessions/'+sessionId,{method:'DELETE'});
  assertStatus(revoked,200,'revoke session');
  const unauthorized=await api('/api/folders');
  assertStatus(unauthorized,401,'revoked cookie rejected');
  const mcp=await api('/mcp',{method:'POST',body:'{}'});
  assert.ok(mcp.status===401||mcp.status===403,'MCP OAuth remains required');
  console.log('PASS full Web API/Cap.js/D1 E2E: login, replay, CSRF, CRUD, CAS, TODO, versions, restore, revocation, MCP isolation');
}
main().catch(err=>{console.error(err);process.exit(1);});
