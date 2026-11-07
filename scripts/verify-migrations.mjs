import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextVersion} from 'text-version';

// Local Wrangler D1 regression: NEVER use --remote or real Cloudflare IDs.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const wrangler=join(root,'node_modules','wrangler','bin','wrangler.js');
assert.ok(existsSync(wrangler),'Run pnpm install before checking migrations');
const tmp=mkdtempSync(join(tmpdir(),'recalloom-migrations-'));
const liveMigrations=join(root,'migrations');
const latestMigrationCount=readdirSync(liveMigrations).filter(name=>/^\d{4}_.*\.sql$/.test(name)).length;
const legacyMigrations=join(tmp,'through-0012');
mkdirSync(legacyMigrations);
for(const name of readdirSync(liveMigrations).filter(name=>/^00(0[1-9]|1[0-2])_.*\.sql$/.test(name)))
  copyFileSync(join(liveMigrations,name),join(legacyMigrations,name));

const config=(label,migrationsDir)=>{
 const path=join(tmp,label+'.json');
 writeFileSync(path,JSON.stringify({
  name:'recalloom-migration-replay-test',
  compatibility_date:'2026-10-26',
  d1_databases:[{
   binding:'DB',
   database_name:'recalloom-migration-replay',
   database_id:'00000000-0000-0000-0000-000000000000',
   migrations_dir:migrationsDir
  }]
 }));
 return path;
};
const complete=config('complete',liveMigrations);
const staged=config('staged',legacyMigrations);

function wr(state,configuration,command,{expectFailure=false}={}){
 const args=['d1',...command,'--local','--persist-to',join(tmp,state),'--config',configuration];
 assert.ok(!args.includes('--remote'));
 const r=spawnSync(process.execPath,[wrangler,...args],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 if(r.error)throw r.error;
 if(expectFailure){
  assert.notEqual(r.status,0,'Unsafe migration must fail before dropping snapshot data');
 }else{
  assert.equal(r.status,0,'Wrangler failed: '+String(r.stdout)+String(r.stderr));
 }
 return r.stdout;
}
const migrate=(state,cfg,opts)=>wr(state,cfg,['migrations','apply','DB'],opts);
function query(state,cfg,sql){
 const out=wr(state,cfg,['execute','DB','--json','--command',sql]);
 const value=JSON.parse(out);
 assert.ok(value[0]?.success,JSON.stringify(value).slice(0,600));
 return value[0].results;
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
function insertSidecarCase(state,includeQuarantine,corruptSnapshot=false){
 const id=includeQuarantine?'safe-example':'unsafe-example';
 const content='test-only current Markdown';
 const sha=hash(content);
 const oldSha=hash('old');
 const tv=new TextVersion();
 tv.commit(content,'2');
 const history=tv.export('separate').metadata;
 const sql=[
  `INSERT INTO records(id,name,kind,created_at,updated_at) VALUES(${quote(id)},'example.md','document','2026-01-01','2026-01-01')`,
  `INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(${quote(id)},${quote(content)},2,${quote(sha)})`,
  `INSERT INTO record_histories(record_id,history_metadata) VALUES(${quote(id)},${quote(history)})`,
  `INSERT INTO revisions(record_id,revision,content_sha256,actor,created_at) VALUES(${quote(id)},1,${quote(oldSha)},'test','2026-01-01')`,
  `INSERT INTO revisions(record_id,revision,content_sha256,actor,created_at) VALUES(${quote(id)},2,${quote(sha)},'test','2026-01-01')`,
  `INSERT INTO record_revision_snapshots(record_id,revision,content,content_sha256) VALUES(${quote(id)},2,${quote(corruptSnapshot?'wrong snapshot body':content)},${quote(sha)})`
 ];
 if(includeQuarantine)sql.push(
  `INSERT INTO record_history_quarantine(record_id,original_metadata,original_revision,original_content_sha256,reason) VALUES(${quote(id)},'archived-broken-history',2,${quote(sha)},'test-only fixture')`
 );
 const fixture=join(tmp,state+'-fixture.sql');
 writeFileSync(fixture,sql.join(';\n')+';\n');
 wr(state,staged,['execute','DB','--file',fixture]);
 return {id,sha};
}

try{
 // Full from-zero replay, then no-op second run.
 migrate('empty',complete);
 assert.equal(query('empty',complete,'SELECT COUNT(*) AS n FROM d1_migrations')[0].n,latestMigrationCount);
 assert.equal(query('empty',complete,
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('record_revision_snapshots','record_history_quarantine')")[0].n,0);
 migrate('empty',complete);
 assert.equal(query('empty',complete,'SELECT COUNT(*) AS n FROM d1_migrations')[0].n,latestMigrationCount);
 console.log('PASS: new D1 applies all '+latestMigrationCount+' migrations and reapply is a no-op');

 // A quarantined, SHA-consistent single-head record can be repaired.
 migrate('repaired',staged);
 const valid=insertSidecarCase('repaired',true);
 migrate('repaired',complete);
 assert.deepEqual(query('repaired',complete,
  'SELECT revision,content_sha256 FROM revisions WHERE record_id='+quote(valid.id)),
  [{revision:2,content_sha256:valid.sha}]);
 assert.equal(query('repaired',complete,
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('record_revision_snapshots','record_history_quarantine')")[0].n,0);
 console.log('PASS: verified quarantined head retained and old revisions retired');

 // Unexpected unquarantined data must block migration, preserving both tables.
 migrate('unsafe',staged);
 insertSidecarCase('unsafe',false);
 migrate('unsafe',complete,{expectFailure:true});
 assert.equal(query('unsafe',complete,'SELECT COUNT(*) AS n FROM d1_migrations')[0].n,12);
 assert.equal(query('unsafe',complete,'SELECT COUNT(*) AS n FROM record_revision_snapshots')[0].n,1);
 assert.equal(query('unsafe',complete,'SELECT COUNT(*) AS n FROM revisions')[0].n,2);
 console.log('PASS: unquarantined snapshots block 0013 without data loss');

 // Even a quarantined record may not discard a snapshot that differs from
 // the registered current body. The failure must roll back every migration step.
 migrate('mismatch',staged);
 insertSidecarCase('mismatch',true,true);
 migrate('mismatch',complete,{expectFailure:true});
 assert.equal(query('mismatch',complete,'SELECT COUNT(*) AS n FROM d1_migrations')[0].n,12);
 assert.equal(query('mismatch',complete,'SELECT COUNT(*) AS n FROM record_revision_snapshots')[0].n,1);
 assert.equal(query('mismatch',complete,'SELECT COUNT(*) AS n FROM revisions')[0].n,2);
 console.log('PASS: mismatched snapshots block 0013 and retain the original audit trail');
}finally{
 rmSync(tmp,{recursive:true,force:true});
}
