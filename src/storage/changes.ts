import type {Env} from '../types.js';
import {bounded} from './internal.js';

export async function changesSince(env:Env,cursor=0,limit=50){
  const size=bounded(limit,200);
  const result=await env.DB.prepare('SELECT seq,revision,actor,created_at AS createdAt,record_id,event_type,entity_type,entity_id,details_json FROM change_events WHERE seq>? ORDER BY seq LIMIT ?').bind(cursor,size+1).all();
  const rows=result.results as Array<{seq:number;revision:number|null;actor:string;createdAt:string;record_id:string|null;event_type:string;entity_type?:string;entity_id?:string;details_json?:string}>;
  const items=rows.slice(0,size).map(({details_json,record_id,event_type,entity_type,entity_id,...rest})=>({
    ...rest,entityType:entity_type??(record_id?'record':null),entityId:entity_id??record_id,
    operation:event_type,details:details_json?JSON.parse(details_json):null
  }));
  const hasMore=rows.length>size;
  return {items,page:{hasMore,nextCursor:items.at(-1)?.seq??cursor}};
}
