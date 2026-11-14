import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const wrangler=join(root,'node_modules','wrangler','bin','wrangler.js');
const suite=[
 'document-heading-e2e.mjs','record-workbench-e2e.mjs','record-stack-e2e.mjs','web-bundle-loading-e2e.mjs','css-layout-e2e.mjs','icon-system-e2e.mjs',
 'rmd-v1-e2e.mjs','rmd-visual-e2e.mjs','rmd-wiki-e2e.mjs',
 'rmd-security-e2e.mjs','rmd-ui-polish-e2e.mjs','rmd-parity-e2e.mjs',
 'rmd-chat-ui-e2e.mjs','editor-inline-menu-e2e.mjs','editor-extra-inline-e2e.mjs',
 'editor-direct-title-e2e.mjs','editor-code-direct-title-e2e.mjs',
 'editor-block-menu-e2e.mjs','editor-child-block-e2e.mjs',
 'editor-block-handle-e2e.mjs','editor-block-drag-e2e.mjs','editor-sketch-drag-preview-e2e.mjs',
 'editor-context-menu-e2e.mjs','editor-interaction-v2-e2e.mjs',
 'editor-interaction-v3-e2e.mjs','editor-toolbar-v4-e2e.mjs','editor-responsive-v5-e2e.mjs','editor-toolbar-selection-v6-e2e.mjs','editor-toolbar-layout-e2e.mjs','editor-format-preview-e2e.mjs','editor-sketch-preview-fragments-e2e.mjs','editor-sketch-drag-sync-v7-e2e.mjs','editor-context-v5-actions-e2e.mjs','editor-rmd-attrs-drawer-e2e.mjs',
 'editor-direct-visible-text-e2e.mjs','editor-rich-container-fields-e2e.mjs',
 'editor-rich-leaf-fields-e2e.mjs','editor-nested-block-handle-e2e.mjs',
 'editor-nested-block-drag-e2e.mjs','editor-container-id-e2e.mjs','revision-diff-e2e.mjs'
];
// Destructive lifecycle tests are opt-in and only run against the local,
// temporary Worker/D1 created by this harness.
const optionalSuites=['archive-management-e2e.mjs','knowledge-graph-e2e.mjs','rmd-help-web-e2e.mjs',
 'web-panels-ui-e2e.mjs','alert-dialog-e2e.mjs','web-ui-e2e.mjs','record-workspace-e2e.mjs','view-transitions-e2e.mjs','shared-title-e2e.mjs','shared-sources-e2e.mjs','mobile-sidebar-e2e.mjs','scroll-navigation-e2e.mjs','recent-card-layout-e2e.mjs','home-recent-updates-e2e.mjs','editor-tablet-sticky-e2e.mjs','editor-undo-clean-e2e.mjs','editor-concurrent-session-e2e.mjs','editor-merge-e2e.mjs','editor-merge-manual-e2e.mjs','editor-performance-e2e.mjs'];
const requested=process.argv.slice(2);
const chosen=requested.length?requested.map(name=>name.replace(/^scripts[\\/]/,'')):suite;
for(const name of chosen)
 assert.ok(suite.includes(name)||optionalSuites.includes(name),'Unknown E2E suite: '+name);
assert.ok(existsSync(wrangler),'Install dependencies before running E2E tests');
assert.ok(existsSync(join(root,'.dev.vars')),'Provide a local .dev.vars with MCP_AUTH_SECRET');
assert.ok(existsSync(join(root,'dist','web','index.html')),'Build the web assets first: pnpm build:web');

function freeLocalPort(){
 return new Promise((ok,fail)=>{
  const socket=createServer();
  socket.once('error',fail);
  socket.listen(0,'127.0.0.1',()=>{
   const address=socket.address();
   const port=address&&typeof address==='object'?address.port:0;
   socket.close(error=>error?fail(error):ok(port));
  });
 });
}
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
let activeChild;
const run=async(program,args,{env=process.env,stdio='inherit'}={})=>{
 const child=spawn(program,args,{cwd:root,env,stdio,windowsHide:true});
 activeChild=child;
 return await new Promise((ok,fail)=>{
  child.once('error',error=>{if(activeChild===child)activeChild=null;fail(error);});
  child.once('close',(code,signal)=>{
   if(activeChild===child)activeChild=null;
   ok({code,signal});
  });
 });
};
function stopTree(child){
 if(!child||!child.pid)return;
 if(process.platform==='win32'){
  try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{
   cwd:root,stdio:'ignore',timeout:12000,windowsHide:true
  });}catch{/* The process may already have exited. */}
 }else{
  try{child.kill('SIGTERM');}catch{/* Already stopped. */}
 }
}
async function ready(base,worker,getLogs){
 for(let i=0;i<150;i++){
  if(interrupted)throw new Error('E2E interrupted');
  if(worker.exitCode!==null)throw new Error('Local Wrangler exited before readiness: '+getLogs());
  try{
   const res=await fetch(base+'/login',{signal:AbortSignal.timeout(1100)});
   if(res.ok)return;
  }catch{/* Wrangler may not be listening yet. */}
  await delay(200);
 }
 throw new Error('Timed out starting local Wrangler: '+getLogs());
}

let worker;
let stateDir;
let failed=false;
let interrupted=false;
const onInterrupt=()=>{
 if(interrupted)return;
 interrupted=true;
 failed=true;
 // Kill only the children launched by this harness. The awaited child exits
 // normally and execution reaches finally, which removes the temporary D1.
 stopTree(activeChild);
 stopTree(worker);
};
process.once('SIGINT',onInterrupt);
process.once('SIGTERM',onInterrupt);
try{
 mkdirSync(join(root,'tmp'),{recursive:true});
 stateDir=mkdtempSync(join(root,'tmp','editor-e2e-'));
 const port=await freeLocalPort();
 const base='http://127.0.0.1:'+port;
 // Disabled ONLY when explicitly requested by this local-only test launcher.
 // Origin, Cap.js proof, OAuth key validation and session checks remain active.
 const limit=process.env.RECALLOOM_E2E_PROTECTED==='true'?'true':'false';
 console.log('E2E: '+chosen.length+' suites, local URL '+base+
  ', Web login rate limit '+(limit==='false'?'disabled for loopback':'enabled'));
 console.log('E2E: applying migrations to a fresh isolated D1 database');
 const migrated=await run(process.execPath,[
  wrangler,'d1','migrations','apply','recalloom','--local','--persist-to',stateDir
 ]);
 if(migrated.code!==0)throw new Error('Local D1 migrations failed');
 let logs='';
 worker=spawn(process.execPath,[
  wrangler,'dev','--ip','127.0.0.1','--port',String(port),'--local',
  '--persist-to',stateDir,'--var','WEB_AUTH_RATE_LIMIT_ENABLED:'+limit
 ],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 for(const stream of [worker.stdout,worker.stderr])
  stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-12000);});
 await ready(base,worker,()=>logs);
 console.log('E2E: server is ready; starting browser scenarios');
 const start=Date.now();
 for(const [index,name] of chosen.entries()){
  if(interrupted)throw new Error('E2E interrupted');
  console.log('E2E ['+(index+1)+'/'+chosen.length+'] '+name);
  const result=await run(process.execPath,[join(root,'scripts',name)],{
   env:{...process.env,RECALLOOM_TEST_BASE:base}
  });
  if(result.code!==0)
   throw new Error('Browser suite failed: '+name+' (exit '+result.code+')');
 }
 console.log('E2E PASS: '+chosen.length+'/'+chosen.length+' scripts ('+
  ((Date.now()-start)/1000).toFixed(1)+'s), one server / one isolated DB');
}catch(error){
 failed=true;
 console.error('E2E FAILED:',error instanceof Error?error.message:String(error));
}finally{
 stopTree(worker);
 // Windows taskkill can return before the stopped Worker releases its SQLite
 // handles. Wait briefly for the child and retry fresh removals, not just the
 // internal rmSync directory traversal. Cleanup failure is a real test failure.
 for(let n=0;worker&&worker.exitCode===null&&n<24;n++)await delay(125);
 if(stateDir){
  let removed=false;
  for(let attempt=0;attempt<15;attempt++){
   try{
    rmSync(stateDir,{recursive:true,force:true,maxRetries:2,retryDelay:150});
    removed=true;break;
   }catch(error){
    if(attempt===14){
     failed=true;
     console.error('E2E FAILED: could not clean isolated D1:',String(error));
    }else await delay(250+attempt*65);
   }
  }
  if(removed)console.log('E2E: temporary Worker and D1 state cleaned');
 }
 process.removeListener('SIGINT',onInterrupt);
 process.removeListener('SIGTERM',onInterrupt);
}
if(failed)process.exitCode=interrupted?130:1;
