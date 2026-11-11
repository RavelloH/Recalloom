#!/usr/bin/env node
// Verify package-to-package resolution, not merely the root dependencies.
// Workers Builds has previously produced an incomplete pnpm virtual-store
// node_modules despite a valid lockfile (Babel helpers, CodeMirror state).
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

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

let failures=inspect();
if(!failures.length){
  console.log('Build dependency links verified: CodeMirror and Babel 7 package resolution intact');
  process.exit(0);
}
console.error('Incomplete dependency installation ('+failures.length+' broken resolution links):');
printFailures(failures);
if(!process.argv.includes('--repair')){
  console.error('Run pnpm install --frozen-lockfile --force --prod=false, then retry.');
  process.exit(1);
}
console.log('Reconstructing pnpm dependency tree from the frozen lockfile...');
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
console.log('Build dependency repair successful; continuing Vite build.');
