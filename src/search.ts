import type { Env } from './types.js';
import { StorageError } from './types.js';
import { DEFAULT_MIN_SEMANTIC_SCORE, reciprocalRankFusion, semanticIntentScore } from './search-ranking.js';

export {EMBEDDING_MODEL,EMBEDDING_DIMENSIONS,splitText,processIndexJobs} from './indexing.js';
import {embed} from './indexing.js';
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
