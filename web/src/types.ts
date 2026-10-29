export type Page={hasMore:boolean;nextCursor:string|number|null};
export type Paged<T>={items:T[];page:Page};
export type Entry={entityType:'folder'|'record';id:string;name:string;description?:string;parentId?:string|null;folderId?:string|null;kind?:'document'|'task_list';status?:string;revision?:number;metadataRevision:number;updatedAt?:string;tags?:string[]};
export type RecordDetail=Entry&{kind:'document'|'task_list';revision:number;metadataRevision:number;content:string;path:string;tags:string[];totalLines:number};
export type Task={id:string;recordId:string;title:string;details?:string;status:'todo'|'in_progress'|'blocked'|'done'|'cancelled';priority:number};
export type Session={id:string;createdAt:number;lastSeenAt:number;expiresAt:number;userAgent:string};
export type Version={revision:number;message?:string;actor?:string;createdAt?:string;contentSha256?:string};
export type Event={id?:string;seq?:number;actor?:string;actorName?:string;actorKind?:'user'|'agent'|'system'|'unknown';clientName?:string|null;operation?:string;resourceName?:string;recordId?:string|null;entityType?:string;entityId?:string;createdAt?:string;revision?:number};
