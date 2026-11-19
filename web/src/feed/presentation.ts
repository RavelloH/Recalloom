import type {FeedItem,FeedViewerState} from '../../../src/feed-model';

export type FeedGroup={key:string;label:string;items:FeedItem[]};

export function feedSourceLabel(url:string|null){
 if(!url)return 'Agent 发现';
 try{return new URL(url).hostname.replace(/^www\./i,'')||'外部来源';}
 catch{return '外部来源';}
}

function calendarKey(date:Date){
 return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

export function groupFeedItems(items:FeedItem[],now=new Date()):FeedGroup[]{
 const today=calendarKey(now);
 const yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
 const yesterdayKey=calendarKey(yesterday);
 const groups:FeedGroup[]=[];
 for(const item of items){
  const date=new Date(item.firstSeenAt);
  const valid=Number.isFinite(date.getTime());
  const key=valid?calendarKey(date):'unknown';
  const label=key===today?'今天':key===yesterdayKey?'昨天':valid?
   new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',...(date.getFullYear()!==now.getFullYear()?{year:'numeric' as const}:{})}).format(date):'更早';
  const last=groups.at(-1);
  if(last?.key===key)last.items.push(item);
  else groups.push({key,label,items:[item]});
 }
 return groups;
}

export function feedReadLabel(item:FeedItem){
 if(item.state.readRevision>=item.revision)return null;
 return item.state.readRevision>0?'有新进展':'未读';
}

export function isFeedSnoozed(state:FeedViewerState,now=Date.now()){
 return state.snoozedUntil!==null&&Date.parse(state.snoozedUntil)>now;
}
