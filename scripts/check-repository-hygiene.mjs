import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {basename} from 'node:path';

// This audit inspects the Git index, not arbitrary local agent files.
// It is a commit hygiene gate; it does not publish personal workspace data.
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).map(s=>s.replaceAll('\\','/'));
const errors=[];
const prohibitedAgentDirs=new Set(['.agents','.agent','.claude','.codex','.cursor']);
for(const file of tracked){
 const parts=file.split('/');
 if(parts.includes('AGENTS.md'))errors.push(file+': personal AGENTS.md must remain local');
 if(parts.some(p=>prohibitedAgentDirs.has(p)))errors.push(file+': agent workspace/config must remain local');
 if(parts[0]==='docs' && (parts.includes('_local') || parts.includes('performance') || /\d{4}-\d{2}-\d{2}/.test(file)))
  errors.push(file+': dated development reports and benchmarks belong in .agents/ or docs/_local/');
 if(/(?:^|\/)(?:scratch|tmp|coverage)\//.test(file)||/\.(?:log|trace)$/.test(file))
  errors.push(file+': generated or transient artifact must not be versioned');
}
const referenceFiles=tracked.filter(file=>
 existsSync(file) && /(?:\.test\.(?:ts|tsx)|\.(?:mjs|js|ts|tsx|json|yaml|yml))$/.test(file)
);
const referenceTexts=new Map(referenceFiles.map(file=>[file,readFileSync(file,'utf8')]));
let linkedTests=0;
for(const file of tracked.filter(file=>/^scripts\/[^/]+-e2e\.mjs$/.test(file))){
 const name=basename(file);
 const owners=[...referenceTexts].filter(([other,content])=>other!==file&&content.includes(name));
 if(owners.length===0)errors.push(file+': unreferenced one-off E2E; either register as a maintained regression or keep locally');
 else linkedTests++;
}
const readme=readFileSync('README.md','utf8');
if(!/^# Recalloom(?:\s|$)/m.test(readme)||!/^## 部署(?:\s|$)/m.test(readme))errors.push('README must introduce the product and explain deployment');
if(/^## (?:技术架构|研发日志|开发记录|本地开发|测试报告|更新历史|迁移记录)(?:\s|$)/m.test(readme))
 errors.push('README must not contain developer task reports or implementation internals');
if(errors.length){console.error('Repository policy violations:\n'+errors.join('\n'));process.exitCode=1}
else console.log('Repository policy verified: '+tracked.length+' tracked files, '+linkedTests+' linked browser regressions; no local agent files or dated work reports');
