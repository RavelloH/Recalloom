export type TaskChange={id:string;title:string;action:'created'|'updated'|'removed'|'transferred';from?:string;to?:string;fields?:string[]};
export type TaskActivity={version:1;created:number;completed:number;reopened:number;removed:number;updated:number;changes:TaskChange[];totalChanges:number};
