#!/usr/bin/env node
// Verify package-to-package resolution, not merely the root dependencies.
// Workers Builds has previously produced an incomplete pnpm virtual-store
// node_modules despite a valid lockfile (Babel helpers, CodeMirror state).
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {existsSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
const edges=[
  ['@uiw/react-codemirror',[
    '@babel/runtime/helpers/extends',
    '@babel/runtime/helpers/objectWithoutPropertiesLoose',
    '@codemirror/state',
    '@codemirror/view',
  ]],
  ['@codemirror/autocomplete',[
    '@codemirror/language',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
  ]],
  ['@codemirror/language',['@codemirror/state','@codemirror/view']],
  [['@uiw/react-codemirror','@uiw/codemirror-extensions-basic-setup'],['@codemirror/state','@codemirror/view']],
  [['@uiw/react-codemirror','@uiw/codemirror-extensions-basic-setup','@codemirror/commands'],['@codemirror/state','@codemirror/view','@codemirror/language']],
];

function inspect(){
  const failures=[];
  for(const [source,dependencies] of edges){
    const chain=Array.isArray(source)?source:[source];
    const importer=chain.join(' -> ');
    let from;
    try{
      let entry=require.resolve(chain[0]);
      for(const dependency of chain.slice(1))entry=createRequire(entry).resolve(dependency);
      from=createRequire(entry);
    }
    catch(error){failures.push({importer,dependency:'(entry)',reason:error.code??error.message});continue;}
    for(const dependency of dependencies){
      try{
        const file=from.resolve(dependency);
        if(!existsSync(file))failures.push({importer,dependency,reason:'missing physical target'});
      }catch(error){failures.push({importer,dependency,reason:error.code??error.message});}
    }
  }
  try{
    const uiw=createRequire(require.resolve('@uiw/react-codemirror'));
    const runtime=uiw('@babel/runtime/package.json').version;
    if(!runtime.startsWith('7.'))failures.push({importer:'@uiw/react-codemirror',dependency:'@babel/runtime',reason:'expected 7.x, found '+runtime});
  }catch(error){failures.push({importer:'@uiw/react-codemirror',dependency:'@babel/runtime/package.json',reason:error.code??error.message});}
  return failures;
}

function printFailures(failures){
  for(const {importer,dependency,reason} of failures)
    console.error('  '+importer+' -> '+dependency+': '+reason);
}

// Workers Builds injects WORKERS_CI=1. Its cached pnpm store has repeatedly
// produced a partial install even when the known CodeMirror links resolve.
// Only on that CI runner, replace the complete hoisted tree once before Vite;
// local builds and GitHub CI keep the fast read-only verification path.
const workersBuild=process.env.WORKERS_CI==='1'&&process.argv.includes('--repair');
let failures=inspect();
if(!failures.length&&!workersBuild){
  console.log('Build dependency links verified: CodeMirror and Babel 7 package resolution intact');
  process.exit(0);
}
if(failures.length){
 console.error('Incomplete dependency installation ('+failures.length+' broken resolution links):');
 printFailures(failures);
}
if(!process.argv.includes('--repair')){
  console.error('Run pnpm install --frozen-lockfile --force --prod=false, then retry.');
  process.exit(1);
}
console.log(workersBuild
 ?'Workers Builds: discarding installed node_modules and reinstalling the frozen hoisted dependency tree...'
 :'Reconstructing pnpm dependency tree from the frozen lockfile...');
if(workersBuild){
 // pnpm 11 can say "Already up to date" in milliseconds when a cached
 // hoisted tree is missing package files. --force alone is not a repair.
 // Never touch user machines or GitHub CI, and require the actual project
 // manifests before removing ONLY this project's generated node_modules.
 if(!['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].every(existsSync)){
  console.error('Expected pnpm project manifests missing; refusing dependency reset');
  process.exit(1);
 }
 const modules=resolve('node_modules');
 console.log('Workers Builds: removing '+modules+' (generated dependency directory only)');
 rmSync(modules,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
const args=['install','--frozen-lockfile','--force','--prod=false'];
const manager=process.env.npm_execpath;
const viaPnpm=manager&&/pnpm/i.test(manager)&&existsSync(manager);
const executable=viaPnpm?process.execPath:process.platform==='win32'?'cmd.exe':'pnpm';
const command=viaPnpm?[manager,...args]:process.platform==='win32'?['/d','/s','/c','pnpm '+args.join(' ')]:args;
const result=spawnSync(executable,command,{stdio:'inherit',env:process.env,windowsHide:true});
if(result.error||result.status!==0){
  console.error('pnpm dependency repair failed:',result.error?.message??'exit '+result.status);
  process.exit(result.status||1);
}
failures=inspect();
if(failures.length){
  console.error('Dependency resolution still broken after forced reinstall:');
  printFailures(failures);
  console.error('Clear the Workers Builds cache and retry the build (Cloudflare dashboard > Settings > Build).');
  process.exit(1);
}
console.log('Build dependency tree verified after installation; continuing Vite build.');
