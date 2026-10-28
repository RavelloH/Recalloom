import type { Env } from './types.js';
import { StorageError } from './types.js';
import { sha256 } from './version.js';

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;
// Conservative lengths work well for Chinese text and short TODOs.
export function splitText(content: string, maxChars=1200): string[] {
  const text=content.trim();
  if(!text) return [];
  const parts:string[]=[];
  for(let offset=0;offset<text.length;offset+=maxChars-120) {
    parts.push(text.slice(offset,offset+maxChars));
    if(offset+maxChars>=text.length)break;
  }
  return parts.slice(0,500);
}
async function embed(env:Env,texts:string[]):Promise<number[][]> {
  if(!texts.length)return [];
  const result = await env.AI.run(EMBEDDING_MODEL,{text:texts}) as unknown as {data?:number[][]};
  if(!Array.isArray(result.data)||result.data.length!==texts.length)
    throw new StorageError('EMBEDDING_FAILED','Embedding model returned unexpected output');
  for(const vector of result.data)if(vector.length!==EMBEDDING_DIMENSIONS)
    throw new StorageError('VECTOR_DIMENSION_MISMATCH');
  return result.data;
}
type IndexedRow={id:string;record_id:string;revision:number;name:string;status:string;content:string};
export async function processIndexJobs(env:Env,limit=3) {
  const jobs=(await env.DB.prepare('SELECT id,record_id,revision,attempts FROM index_jobs WHERE state IN (\'pending\',\'failed\') AND attempts<5 ORDER BY created_at LIMIT ?').bind(Math.min(10,Math.max(1,limit))).all()).results as Array<{id:string;record_id:string;revision:number;attempts:number}>;
  const results=[];
  for(const job of jobs) {
    const record=await env.DB.prepare('SELECT r.id,r.name,r.status,c.content,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?').bind(job.record_id).first<IndexedRow>();
    if(!record||record.revision!==job.revision){
      await env.DB.prepare('UPDATE index_jobs SET state=\'done\' WHERE id=?').bind(job.id).run();
      results.push({id:job.id,skipped:'stale'});continue;
    }
    try {
      await env.DB.prepare('UPDATE index_jobs SET state=\'running\',attempts=attempts+1 WHERE id=?').bind(job.id).run();
      const old=(await env.DB.prepare('SELECT chunk_id FROM search_chunks WHERE record_id=?').bind(job.record_id).all()).results.map(r=>String(r.chunk_id));
      const chunks=record.status==='archived'?[]:splitText(record.name+'\n'+record.content);
      const ids=chunks.map((_,i)=>record.id+':'+i);
      if(chunks.length) {
        // Batch embedding requests for speed, keeping inference inputs bounded.
        const vectors:number[][]=[];
        for(let i=0;i<chunks.length;i+=8) vectors.push(...await embed(env,chunks.slice(i,i+8)));
        for(let i=0;i<ids.length;i+=100){
          await env.VECTORIZE.upsert(ids.slice(i,i+100).map((id,j)=>({
            id,values:vectors[i+j]!,metadata:{record_id:record.id,revision:record.revision,chunk_index:i+j}
          })));
        }
      }
      // A stale index can exist briefly; semantic results always validate against D1.
      const obsolete=old.filter(id=>!ids.includes(id));
      if(obsolete.length) await env.VECTORIZE.deleteByIds(obsolete);
      const latest=await env.DB.prepare('SELECT revision FROM record_contents WHERE record_id=?').bind(job.record_id).first<{revision:number}>();
      if(latest?.revision!==job.revision){
        await env.DB.prepare('UPDATE index_jobs SET state=\'done\' WHERE id=?').bind(job.id).run();
        results.push({id:job.id,skipped:'changed_during_index'});continue;
      }
      const statements=[env.DB.prepare('DELETE FROM search_chunks WHERE record_id=?').bind(record.id)];
      for (const [i,chunk] of chunks.entries()) statements.push(env.DB.prepare('INSERT INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) VALUES(?,?,?,?,?)').bind(ids[i]!,record.id,record.revision,i,chunk));
      statements.push(env.DB.prepare('UPDATE index_jobs SET state=\'done\',last_error=NULL WHERE id=?').bind(job.id));
      await env.DB.batch(statements);
      results.push({id:job.id,chunks:chunks.length});
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      await env.DB.prepare('UPDATE index_jobs SET state=\'failed\',last_error=? WHERE id=?').bind(message.slice(0,800),job.id).run();
      results.push({id:job.id,error:message});
    }
  }
  return {processed:results.length,results};
}
export async function search(env:Env,input:{query:string;mode?:'metadata'|'literal'|'semantic'|'hybrid'|'auto';folderId?:string;status?:string;tag?:string;limit?:number}) {
  const query=input.query.trim(), mode=input.mode??'auto',limit=Math.min(30,Math.max(1,input.limit??10));
  if(!query)throw new StorageError('EMPTY_QUERY');
  const metadata=mode==='metadata'||mode==='literal'||mode==='hybrid'||mode==='auto';
  const semantic=mode==='semantic'||mode==='hybrid'||mode==='auto';
  const matches=new Map<string,{id:string;name:string;status:string;kind:string;revision:number;score:number;source:string;snippet:string}>();
  const filterSql=['r.status != \'archived\''];
  const bind:(string|number)[]=[];
  if(input.folderId){filterSql.push('r.folder_id=?');bind.push(input.folderId);}
  if(input.status){filterSql.push('r.status=?');bind.push(input.status);}
  if(input.tag){filterSql.push('EXISTS(SELECT 1 FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=r.id AND t.name=?)');bind.push(input.tag);}
  if(metadata) {
    const where=mode==='metadata'
      ?'(instr(lower(r.name),lower(?))>0 OR instr(lower(r.description),lower(?))>0)'
      :'(instr(lower(r.name),lower(?))>0 OR instr(lower(c.content),lower(?))>0)';
    const rows=(await env.DB.prepare('SELECT r.id,r.name,r.kind,r.status,c.revision,c.content FROM records r JOIN record_contents c ON c.record_id=r.id WHERE '+filterSql.join(' AND ')+' AND '+where+' ORDER BY r.updated_at DESC LIMIT ?')
      .bind(...bind,query,query,limit*3).all()).results as Array<{id:string;name:string;status:string;kind:string;revision:number;content:string}>;
    for(const row of rows) {
      const pos=row.content.toLowerCase().indexOf(query.toLowerCase());
      matches.set(row.id,{id:row.id,name:row.name,status:row.status,kind:row.kind,revision:row.revision,score:pos<0?0.8:1,source:mode==='metadata'?'metadata':'literal',snippet:pos<0?row.content.slice(0,200):row.content.slice(Math.max(0,pos-80),pos+200)});
    }
  }
  if(semantic) {
    const vector=(await embed(env,[query]))[0]!;
    const result=await env.VECTORIZE.query(vector,{topK:Math.min(50,Math.max(20,limit*5)),returnMetadata:'all'});
    const rows=result.matches.filter(m=>m.metadata&&typeof m.metadata.record_id==='string');
    for(const match of rows) {
      const recordId=String(match.metadata!.record_id), revision=Number(match.metadata!.revision);
      if(matches.has(recordId))continue;
      const row=await env.DB.prepare('SELECT r.id,r.name,r.kind,r.status,r.folder_id,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?').bind(recordId).first<{id:string;name:string;kind:string;status:string;folder_id:string|null;revision:number}>();
      if(!row||row.revision!==revision||row.status==='archived'||(input.folderId&&row.folder_id!==input.folderId)||(input.status&&row.status!==input.status))continue;
      if(input.tag) {
        const tag=await env.DB.prepare('SELECT 1 FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=? AND t.name=?').bind(recordId,input.tag).first();
        if(!tag)continue;
      }
      const chunk=await env.DB.prepare('SELECT content FROM search_chunks WHERE chunk_id=? AND revision=?').bind(match.id,revision).first<{content:string}>();
      if(!chunk)continue;
      matches.set(recordId,{id:recordId,name:row.name,status:row.status,kind:row.kind,revision,score:match.score,source:'semantic',snippet:chunk.content.slice(0,350)});
    }
  }
  const results=[...matches.values()].sort((a,b)=>b.score-a.score).slice(0,limit);
  return {results,count:results.length,mode,indexMayLag:semantic};
}
