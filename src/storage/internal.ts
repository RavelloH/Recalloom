import type {Env} from '../types.js';
import {StorageError} from '../types.js';

export const now = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

export const event=(env:Env,entityType:'record'|'folder',entityId:string,operation:string,revision:number|null,actor:string,details:unknown=null)=>env.DB.prepare(
  'INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)'
).bind(entityType==='record'?entityId:null,operation,revision,actor,now(),entityType,entityId,JSON.stringify(details));

export async function recordExtras(env:Env,folderId:string|null,recordId:string){
  const [tags,parents]=await Promise.all([
    env.DB.prepare('SELECT t.name FROM tags t JOIN record_tags rt ON rt.tag_id=t.id WHERE rt.record_id=? ORDER BY t.name').bind(recordId).all<{name:string}>(),
    folderId?env.DB.prepare('WITH RECURSIVE a(id,parent_id,name,depth) AS (SELECT id,parent_id,name,0 FROM folders WHERE id=? UNION ALL SELECT f.id,f.parent_id,f.name,a.depth+1 FROM folders f JOIN a ON f.id=a.parent_id) SELECT name FROM a ORDER BY depth DESC').bind(folderId).all<{name:string}>():Promise.resolve({results:[] as {name:string}[]})
  ]);
  return {tags:tags.results.map(t=>t.name),path:'/'+[...parents.results.map(p=>p.name)].join('/')};
}

export const normalizeTags=(values: string[] = []): string[] => {
  if(values.length>32)throw new StorageError('INVALID_TAG','At most 32 tags per record');
  const tags=values.map(value=>value.trim().toLowerCase());
  if(tags.some(tag=>!tag||tag.length>64))throw new StorageError('INVALID_TAG');
  return [...new Set(tags)];
};

export const bounded = (n: number, max=100) => Math.min(max,Math.max(1,Math.floor(n||20)));

export const nameCheck = (name: string) => {
  if (!name.trim() || name.includes('/') || name.includes('\\') || name.length > 180)
    throw new StorageError('INVALID_NAME','Name must contain 1-180 characters, without path separators');
  return name.trim();
};
