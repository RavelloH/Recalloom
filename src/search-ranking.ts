/**
 * Lightweight retrieval scoring without a second model invocation.
 * Semantic confidence is evaluated before lexical intent hints. This prevents
 * a stray token match from promoting irrelevant vector results.
 */
// Gemma 512 calibration on the current multilingual library. Callers may lower
// this candidate filter for exploratory recall. It does not measure answerability.
export const DEFAULT_MIN_SEMANTIC_SCORE = 0.68;
const FUSION_K = 60;

export function searchTerms(query:string):string[]{
  const words=query.toLowerCase().match(/[a-z][a-z0-9_-]{1,}|[\u3400-\u9fff]{2,}/g)??[];
  const tokens=new Set<string>();
  for(const word of words){
    if(/^[\u3400-\u9fff]+$/.test(word)){
      for(let i=0;i<word.length-1&&tokens.size<64;i++)tokens.add(word.slice(i,i+2));
    }else if(word.length>2)tokens.add(word);
    if(tokens.size>=64)break;
  }
  return [...tokens];
}

/** Prefer a document's own title to mentions in another document's body. */
export function searchTitleMatch(query:string,titles:string[]):number{
  const normalize=(text:string)=>text.toLowerCase().replace(/\.md$/,'').replace(/[\s|｜·:_—–-]+/g,'');
  const needle=normalize(query),values=titles.map(normalize).filter(Boolean);
  if(!needle)return 0;
  if(values.includes(needle))return 3;
  return needle.length>=2&&values.some(title=>title.includes(needle))?2:0;
}

export function semanticIntentScore(query: string, passage: string, similarity: number): number {
  const negative = [...query.matchAll(/(?:而不是|不是|而非|不使用|不用|排除|instead of|rather than|without)\s*([^，。！？,;；.!?\n]{2,30})/gi)]
    .map(match => match[1]!.trim().toLowerCase());
  const positiveQuery = query.replace(/(?:而不是|不是|而非|不使用|不用|排除|instead of|rather than|without)\s*[^，。！？,;；.!?\n]{2,30}/gi,'');
  const lower = passage.toLowerCase();
  const tokens=searchTerms(positiveQuery);
  const matched = tokens.filter(token=>lower.includes(token)).length;
  const coverage=tokens.length ? matched/tokens.length : 0;
  const excluded = negative.some(phrase => lower.includes(phrase));
  return Math.min(1,Math.max(0,similarity + 0.06*coverage - (excluded ? 0.15 : 0)));
}

export function reciprocalRankFusion(lexicalRank?:number,semanticRank?:number):number {
  const sum=(lexicalRank===undefined?0:1/(FUSION_K+lexicalRank))
    +(semanticRank===undefined?0:1/(FUSION_K+semanticRank));
  return Math.min(1,sum/(2/(FUSION_K+1)));
}

/**
 * Avoid cutting ordinary Markdown mid-sentence when a paragraph/line boundary
 * lies near the desired chunk length. Retain a small overlap for continuity.
 */
export function paragraphChunks(content:string,maxChars=1200):string[] {
  return paragraphChunkSpans(content,maxChars).map(chunk=>chunk.text);
}

/** UTF-16 source positions use the same boundaries as the embedding input. */
export function paragraphChunkSpans(content:string,maxChars=1200):Array<{text:string;start:number;end:number}>{
  const text=content.trim();
  if(!text)return [];
  const offset=content.length-content.trimStart().length;
  const max=Math.max(160,Math.floor(maxChars));
  const overlap=Math.min(120,Math.floor(max/10));
  const chunks:Array<{text:string;start:number;end:number}>=[];
  let start=0;
  while(start<text.length && chunks.length<500){
    if(text.length-start<=max) {
      chunks.push({text:text.slice(start),start:start+offset,end:text.length+offset});
      break;
    }
    const desired=start+max;
    const minBreak=start+Math.floor(max*0.6);
    let end=-1;
    const candidates=['\n\n','\n','。','！','？','. ','; ','；'];
    for(const delimiter of candidates){
      const position=text.lastIndexOf(delimiter,desired);
      if(position>=minBreak && position+delimiter.length>start){
        end=position+delimiter.length;
        break;
      }
    }
    if(end<0)end=desired;
    chunks.push({text:text.slice(start,end),start:start+offset,end:end+offset});
    const next=Math.max(start+1,end-overlap);
    start=next;
  }
  return chunks;
}
