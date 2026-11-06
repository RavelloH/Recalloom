#!/usr/bin/env node
/** Offline repair plan. Does not contact production. Input/output private paths only. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {TextVersion} from 'text-version';
const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath||!inputPath.includes('/repair-backups/')||!outputPath.includes('/repair-backups/'))throw Error('Expected private backup input and output paths');
const rows=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
if(!Array.isArray(rows)||rows.length<1||rows.length>10)throw Error('Expected 1–10 records');
const ids=new Set(),commands=['-- Offline-generated guarded repair plan, requires migrations 0011 and 0012.'];
for(const row of rows){
 const {id,revision,content,contentSha256,historyMetadata}=row;
 if(ids.has(id)||!/^[0-9a-f-]{36}$/.test(id)||!Number.isInteger(revision)||revision<2||typeof content!=='string'||typeof historyMetadata!=='string'||!/^[0-9a-f]{64}$/.test(contentSha256)||sha(content)!==contentSha256)throw Error('Invalid input '+id);
 ids.add(id);
 const tv=new TextVersion();tv.commit(content||'\0',String(revision));
 const clean=tv.export('separate').metadata;
 if(!clean||clean.includes('\0')||new TextVersion(clean,content||'\0').show(String(revision))!==(content||'\0'))throw Error('Broken round-trip '+id);
 const old=new TextVersion(historyMetadata,content||'\0').getParsedData();
 if(!old.versions.length||old.versions.at(-1)!==String(revision))throw Error('Unexpected head '+id);
 const i=q(id),r=revision,h=q(contentSha256);
 commands.push('-- Record '+id+' rev '+r+' original_metadata_sha256 '+sha(historyMetadata));
 commands.push('INSERT OR IGNORE INTO record_history_quarantine(record_id,original_metadata,original_revision,original_content_sha256,reason) '+
 'SELECT h.record_id,h.history_metadata,c.revision,c.content_sha256,'+q('legacy text-version corruption; archive for future SHA-verified recovery')+
 ' FROM record_histories h JOIN record_contents c ON c.record_id=h.record_id WHERE h.record_id='+i+
 ' AND c.revision='+r+' AND c.content_sha256='+h+';');
 commands.push('INSERT OR IGNORE INTO record_revision_snapshots(record_id,revision,content,content_sha256) '+
 'SELECT c.record_id,c.revision,c.content,c.content_sha256 FROM record_contents c WHERE c.record_id='+i+
 ' AND c.revision='+r+' AND c.content_sha256='+h+';');
 commands.push('UPDATE record_histories SET history_metadata='+q(clean)+' WHERE record_id='+i+
 ' AND EXISTS (SELECT 1 FROM record_history_quarantine a JOIN record_contents c ON c.record_id=a.record_id'+
 ' WHERE a.record_id=record_histories.record_id AND a.original_metadata=record_histories.history_metadata'+
 ' AND a.original_revision='+r+' AND c.revision='+r+
 ' AND a.original_content_sha256='+h+' AND c.content_sha256='+h+');');
}
fs.writeFileSync(outputPath,commands.join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({plannedRecords:rows.length,ids:[...ids],sqlBytes:fs.statSync(outputPath).size}));
