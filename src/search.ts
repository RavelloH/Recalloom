import type { Env } from './types.js';
import { StorageError } from './types.js';
import { DEFAULT_MIN_SEMANTIC_SCORE, paragraphChunks, reciprocalRankFusion, semanticIntentScore } from './search-ranking.js';

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;
// Preserves natural paragraph and line boundaries while retaining overlap.
export const splitText = paragraphChunks;
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
  const expired=new Date(Date.now()-5*60*1000).toISOString();
  await env.DB.prepare("UPDATE index_jobs SET state='failed',started_at=NULL,last_error='Lease expired after maximum retries' WHERE state='running' AND attempts>=5 AND (started_at IS NULL OR started_at<?)")
    .bind(expired).run();
  const jobs=(await env.DB.prepare("SELECT id,record_id,revision,attempts FROM index_jobs WHERE attempts<5 AND (state IN ('pending','failed') OR (state='running' AND (started_at IS NULL OR started_at<?))) ORDER BY created_at LIMIT ?")
    .bind(expired,Math.min(10,Math.max(1,limit))).all()).results as Array<{id:string;record_id:string;revision:number;attempts:number}>;
  const results=[];
  for(const job of jobs) {
    const record=await env.DB.prepare('SELECT r.id,r.name,r.status,c.content,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?').bind(job.record_id).first<IndexedRow>();
    if(!record||record.revision!==job.revision){
      await env.DB.prepare('UPDATE index_jobs SET state=\'done\' WHERE id=?').bind(job.id).run();
      results.push({id:job.id,skipped:'stale'});continue;
    }
    try {
      const claimed=await env.DB.prepare("UPDATE index_jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=? AND attempts<5 AND (state IN ('pending','failed') OR (state='running' AND (started_at IS NULL OR started_at<?)))")
        .bind(new Date().toISOString(),job.id,expired).run();
      if(!claimed.meta.changes){results.push({id:job.id,skipped:'claimed_elsewhere'});continue;}
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
      await env.DB.prepare("UPDATE index_jobs SET state='failed',started_at=NULL,last_error=? WHERE id=?").bind(message.slice(0,800),job.id).run();
      results.push({id:job.id,error:message});
    }
  }
  return {processed:results.length,results};
}
type SearchRow={id:string;name:string;kind:string;status:string;revision:number;score:number;source:string;snippet:string;semanticScore?:number};

export async function search(env:Env,input:{
  query:string;mode?:'metadata'|'literal'|'semantic'|'hybrid'|'auto';
  folderId?:string;status?:string;tag?:string;limit?:number;minScore?:number
}) {
  const query=input.query.trim(),mode=input.mode??'auto',limit=Math.min(30,Math.max(1,input.limit??10));
  const minScore=input.minScore??DEFAULT_MIN_SEMANTIC_SCORE;
  if(!query)throw new StorageError('EMPTY_QUERY');
  if(!Number.isFinite(minScore)||minScore<0||minScore>1)throw new StorageError('INVALID_MIN_SCORE');
  const metadata=mode!=='semantic';
  const semantic=mode==='semantic'||mode==='hybrid'||mode==='auto';
  const lexicalResults:SearchRow[]=[];
  const semanticById=new Map<string,SearchRow>();
  const filterSql=["r.status != 'archived'"];
  const bind:(string|number)[]=[];
  if(input.folderId){filterSql.push('r.folder_id=?');bind.push(input.folderId);}
  if(input.status){filterSql.push('r.status=?');bind.push(input.status);}
  if(input.tag){
    filterSql.push('EXISTS(SELECT 1 FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=r.id AND t.name=?)');
    bind.push(input.tag);
  }
  if(metadata){
    const clause=mode==='metadata'
      ?'(instr(lower(r.name),lower(?))>0 OR instr(lower(r.description),lower(?))>0)'
      :'(instr(lower(r.name),lower(?))>0 OR instr(lower(c.content),lower(?))>0)';
    const records=(await env.DB.prepare(
      'SELECT r.id,r.name,r.kind,r.status,c.revision,c.content FROM records r JOIN record_contents c ON c.record_id=r.id WHERE '
      +filterSql.join(' AND ')+' AND '+clause+' ORDER BY r.updated_at DESC LIMIT ?'
    ).bind(...bind,query,query,Math.min(90,limit*3)).all()).results as Array<{
      id:string;name:string;kind:string;status:string;revision:number;content:string
    }>;
    for(const row of records){
      const pos=row.content.toLowerCase().indexOf(query.toLowerCase());
      lexicalResults.push({id:row.id,name:row.name,kind:row.kind,status:row.status,revision:row.revision,
        score:mode==='metadata'?0.8:pos<0?0.8:1,
        source:mode==='metadata'?'metadata':'literal',
        snippet:pos<0?row.content.slice(0,200):row.content.slice(Math.max(0,pos-80),pos+200)});
    }
    // Exact content hits rank above title-only hits while preserving recency for ties.
    lexicalResults.sort((a,b)=>b.score-a.score);
  }
  if(semantic){
    const vector=(await embed(env,[query]))[0]!;
    const result=await env.VECTORIZE.query(vector,{
      topK:Math.min(50,Math.max(20,limit*5)),returnMetadata:'all'
    });
    const candidates=result.matches.filter(m=>
      m.score>=minScore && m.metadata && typeof m.metadata.record_id==='string'
    );
    if(candidates.length){
      // One D1 read instead of a separate record and chunk query per vector hit.
      const chunkIds=[...new Set(candidates.map(c=>c.id))];
      const where=["s.chunk_id IN ("+chunkIds.map(()=>'?').join(',')+")",
        's.revision=c.revision',...filterSql];
      const rows=(await env.DB.prepare(
        'SELECT s.chunk_id,s.content,r.id,r.name,r.kind,r.status,c.revision '+
        'FROM search_chunks s JOIN records r ON r.id=s.record_id '+
        'JOIN record_contents c ON c.record_id=r.id WHERE '+where.join(' AND ')
      ).bind(...chunkIds,...bind).all()).results as Array<{
        chunk_id:string;content:string;id:string;name:string;kind:string;status:string;revision:number
      }>;
      const byChunk=new Map(rows.map(row=>[row.chunk_id,row]));
      for(const hit of candidates){
        const row=byChunk.get(hit.id);
        if(!row||row.revision!==Number(hit.metadata!.revision))continue;
        const score=semanticIntentScore(query,row.name+'\n'+row.content,hit.score);
        if(score<minScore)continue;
        const prior=semanticById.get(row.id);
        if(prior&&prior.score>=score)continue;
        semanticById.set(row.id,{
          id:row.id,name:row.name,kind:row.kind,status:row.status,revision:row.revision,
          score,semanticScore:hit.score,source:'semantic',snippet:row.content.slice(0,350)
        });
      }
    }
  }
  if(mode==='metadata'||mode==='literal'){
    const results=lexicalResults.slice(0,limit);
    return {results,count:results.length,mode,indexMayLag:false};
  }
  const vectorResults=[...semanticById.values()].sort((a,b)=>b.score-a.score);
  if(mode==='semantic'){
    const results=vectorResults.slice(0,limit);
    return {results,count:results.length,mode,indexMayLag:true};
  }
  // Reciprocal Rank Fusion puts lexical and semantic rankings on the same
  // scale, rather than comparing "literal = 1" against raw cosine scores.
  const combined=new Map<string,SearchRow & {lexicalRank?:number;semanticRank?:number}>();
  for(const [i,row] of lexicalResults.entries())combined.set(row.id,{...row,lexicalRank:i+1});
  for(const [i,row] of vectorResults.entries()){
    const existing=combined.get(row.id);
    if(existing)combined.set(row.id,{...row,source:'hybrid',lexicalRank:existing.lexicalRank,semanticRank:i+1,
      snippet:existing.snippet});
    else combined.set(row.id,{...row,semanticRank:i+1});
  }
  const results=[...combined.values()].map(({lexicalRank,semanticRank,...row})=>({
    ...row,score:reciprocalRankFusion(lexicalRank,semanticRank)
  })).sort((a,b)=>b.score-a.score || (b.semanticScore??0)-(a.semanticScore??0)).slice(0,limit);
  return {results,count:results.length,mode,indexMayLag:true};
}
