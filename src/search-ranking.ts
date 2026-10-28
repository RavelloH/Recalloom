/**
 * Lightweight retrieval scoring without a second model invocation.
 * Semantic confidence is evaluated before lexical intent hints. This prevents
 * a stray token match from promoting irrelevant vector results.
 */
export const DEFAULT_MIN_SEMANTIC_SCORE = 0.43;
const FUSION_K = 60;

export function semanticIntentScore(query: string, passage: string, similarity: number): number {
  const negative = [...query.matchAll(/(?:而不是|不是|而非|不使用|不用|排除|instead of|rather than|without)\s*([^，。！？,;；.!?\n]{2,30})/gi)]
    .map(match => match[1]!.trim().toLowerCase());
  const positiveQuery = query.replace(/(?:而不是|不是|而非|不使用|不用|排除|instead of|rather than|without)\s*[^，。！？,;；.!?\n]{2,30}/gi,'');
  const lower = passage.toLowerCase();
  const source = positiveQuery.toLowerCase();
  // Include English/code identifiers as whole tokens and Chinese 2-grams.
  const words = source.match(/[a-z][a-z0-9_-]{1,}|[\u3400-\u9fff]{2,}/g) ?? [];
  const tokens = new Set<string>();
  for (const word of words) {
    if (/^[\u3400-\u9fff]+$/.test(word)) {
      for(let i=0; i<word.length-1;i++)tokens.add(word.slice(i,i+2));
    } else if(word.length>2)tokens.add(word);
  }
  const matched = [...tokens].filter(token=>lower.includes(token)).length;
  const coverage=tokens.size ? matched/tokens.size : 0;
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
  const text=content.trim();
  if(!text)return [];
  const max=Math.max(160,Math.floor(maxChars));
  const overlap=Math.min(120,Math.floor(max/10));
  const chunks:string[]=[];
  let start=0;
  while(start<text.length && chunks.length<500){
    if(text.length-start<=max) {
      chunks.push(text.slice(start));
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
    chunks.push(text.slice(start,end));
    const next=Math.max(start+1,end-overlap);
    start=next;
  }
  return chunks;
}
