import type { Env } from './types.js';
import { StorageError } from './types.js';
import { DEFAULT_MIN_SEMANTIC_SCORE, reciprocalRankFusion, semanticIntentScore,searchTitleMatch } from './search-ranking.js';
import {parseMarkdownOutline} from './outline.js';
import {searchExcerpt,type SearchDocument} from './search-excerpt.js';

export {EMBEDDING_MODEL,EMBEDDING_DIMENSIONS,splitText,processIndexJobs} from './indexing.js';
import {embed} from './indexing.js';
type SearchRow={id:string;name:string;kind:string;status:string;revision:number;score:number;source:string;sourceText:string;chunkIndex?:number;semanticScore?:number};

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
  const titleMatches=new Map<string,number>();
  const documents=new Map<string,SearchDocument>();
  const finish=async(rows:SearchRow[])=>{
    const missing=rows.filter(row=>row.chunkIndex!==undefined&&!documents.has(row.id));
    if(missing.length){
      const originals=(await env.DB.prepare("SELECT r.id,r.name,c.revision,c.content FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.status<>'archived' AND r.id IN ("+missing.map(()=>'?').join(',')+")").bind(...missing.map(row=>row.id)).all()).results as Array<SearchDocument&{id:string}>;
      for(const document of originals)documents.set(document.id,document);
    }
    return rows.flatMap(({sourceText,...row})=>{
      const document=documents.get(row.id);
      if((document&&document.revision!==row.revision)||(missing.some(candidate=>candidate.id===row.id)&&!document))return [];
      return [{...row,...searchExcerpt(query,sourceText,document,row.chunkIndex)}];
    });
  };
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
    const folderMatch="(lower(r.name) IN ('readme','readme.md') AND instr(lower(COALESCE(f.name,'')),lower(?))>0)";
    const clause=mode==='metadata'
      ?'(instr(lower(r.name),lower(?))>0 OR instr(lower(r.description),lower(?))>0 OR '+folderMatch+')'
      :'(instr(lower(r.name),lower(?))>0 OR instr(lower(c.content),lower(?))>0'+(mode==='literal'?'':' OR '+folderMatch)+')';
    const records=(await env.DB.prepare(
      'SELECT r.id,r.name,r.kind,r.status,c.revision,c.content,f.name AS folderName FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE '
      +filterSql.join(' AND ')+' AND '+clause+" ORDER BY CASE WHEN lower(r.name)=lower(?) OR lower(r.name)=lower(?)||'.md' OR (lower(r.name) IN ('readme','readme.md') AND lower(f.name)=lower(?)) THEN 0 ELSE 1 END,r.updated_at DESC LIMIT ?"
    ).bind(...bind,query,query,...(mode==='literal'?[]:[query]),query,query,query,Math.min(90,Math.max(30,limit*3))).all()).results as Array<{
      id:string;name:string;kind:string;status:string;revision:number;content:string;folderName?:string|null
    }>;
    for(const row of records){
      documents.set(row.id,row);
      const heading=parseMarkdownOutline(row.content.slice(0,8192),1).headings[0];
      const titles=[row.name,heading?.level===1?heading.title:''];
      if(/^readme(?:\.md)?$/i.test(row.name)&&row.folderName)titles.push(row.folderName);
      titleMatches.set(row.id,searchTitleMatch(query,titles));
      const pos=row.content.toLowerCase().indexOf(query.toLowerCase());
      lexicalResults.push({id:row.id,name:row.name,kind:row.kind,status:row.status,revision:row.revision,
        score:mode==='metadata'?0.8:pos<0?0.8:1,
        source:mode==='metadata'?'metadata':'literal',
        sourceText:row.content});
    }
    // Own titles rank above body mentions, with recency preserved for ties.
    lexicalResults.sort((a,b)=>(titleMatches.get(b.id)!-titleMatches.get(a.id)!)||b.score-a.score);
  }
  if(semantic){
    const vector=(await embed(env,['task: search result | query: '+query]))[0]!;
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
        'SELECT s.chunk_id,s.content,r.id,r.name,r.kind,r.status,c.revision,s.chunk_index '+
        'FROM search_chunks s JOIN records r ON r.id=s.record_id '+
        'JOIN record_contents c ON c.record_id=r.id WHERE '+where.join(' AND ')
      ).bind(...chunkIds,...bind).all()).results as Array<{
        chunk_id:string;chunk_index?:number;content:string;id:string;name:string;kind:string;status:string;revision:number
      }>;
      const byChunk=new Map(rows.map(row=>[row.chunk_id,row]));
      for(const hit of candidates){
        const row=byChunk.get(hit.id);
        if(!row||row.id!==hit.metadata!.record_id||row.revision!==Number(hit.metadata!.revision))continue;
        const score=semanticIntentScore(query,row.name+'\n'+row.content,hit.score);
        if(score<minScore)continue;
        const prior=semanticById.get(row.id);
        if(prior&&prior.score>=score)continue;
        semanticById.set(row.id,{
          id:row.id,name:row.name,kind:row.kind,status:row.status,revision:row.revision,
          score,semanticScore:hit.score,source:'semantic',sourceText:row.content,chunkIndex:row.chunk_index
        });
      }
    }
  }
  if(mode==='metadata'||mode==='literal'){
    const results=await finish(lexicalResults.slice(0,limit));
    return {results,count:results.length,mode,indexMayLag:false};
  }
  const vectorResults=[...semanticById.values()].sort((a,b)=>b.score-a.score);
  if(mode==='semantic'){
    const results=await finish(vectorResults.slice(0,limit));
    return {results,count:results.length,mode,indexMayLag:true};
  }
  // Reciprocal Rank Fusion puts lexical and semantic rankings on the same
  // scale, rather than comparing "literal = 1" against raw cosine scores.
  const combined=new Map<string,SearchRow & {lexicalRank?:number;semanticRank?:number}>();
  for(const [i,row] of lexicalResults.entries())combined.set(row.id,{...row,lexicalRank:i+1});
  for(const [i,row] of vectorResults.entries()){
    const existing=combined.get(row.id);
    if(existing)combined.set(row.id,{...row,source:'hybrid',lexicalRank:existing.lexicalRank,semanticRank:i+1,
      sourceText:existing.sourceText,chunkIndex:existing.chunkIndex});
    else combined.set(row.id,{...row,semanticRank:i+1});
  }
  const ranked=[...combined.values()].map(({lexicalRank,semanticRank,...row})=>({
    ...row,score:titleMatches.get(row.id)===3?1:reciprocalRankFusion(lexicalRank,semanticRank)
  })).sort((a,b)=>b.score-a.score || (b.semanticScore??0)-(a.semanticScore??0)).slice(0,limit);
  const results=await finish(ranked);
  return {results,count:results.length,mode,indexMayLag:true};
}
