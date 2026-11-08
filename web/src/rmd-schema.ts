/** RMD 1.0 public syntax schema. No legacy :name[label]{attrs} aliases. */
export type RmdNodeType='inline'|'block'|'leaf';
export type RmdSchema={
 name:string;type:RmdNodeType;main:'required'|'optional'|'forbidden';
 positions:readonly string[]; attributes:Readonly<Record<string,'string'|'boolean'|'integer'|'color'|'variant'|'id'>>;
 allowedParents?:readonly string[]; children?:readonly string[];
};
export const RMD_COLORS=['red','orange','yellow','green','blue','purple','pink','cyan','teal'] as const;
export const RMD_VARIANTS=['neutral','info','success','warning','danger'] as const;
const inline=(name:string,main:RmdSchema['main']='required',positions:string[]=[],attrs:RmdSchema['attributes']={}):RmdSchema=>({
 name,type:'inline',main,positions,attributes:attrs
});
const block=(name:string,main:RmdSchema['main']='optional',positions:string[]=[],attrs:RmdSchema['attributes']={},children?:readonly string[]):RmdSchema=>({
 name,type:'block',main,positions,attributes:{id:'id',...attrs},children
});
const child=(name:string,parents:readonly string[],main:RmdSchema['main']='optional',positions:string[]=[],attrs:RmdSchema['attributes']={}):RmdSchema=>({
 name,type:'block',main,positions,attributes:attrs,allowedParents:parents
});
const leaf=(name:string,positions:string[]=[],attrs:RmdSchema['attributes']={}):RmdSchema=>({
 name,type:'leaf',main:'required',positions,attributes:attrs
});
const list:RmdSchema[]=[
 inline('mark'),inline('highlight','required',['color'],{color:'color'}),
 inline('badge','required',['variant'],{variant:'variant'}),
 inline('tooltip','required',['description'],{description:'string'}),
 inline('abbr','required',['description'],{description:'string'}),
 inline('kbd'),inline('cloze','required',['hint'],{hint:'string'}),
 ...['note','info','tip','success','warning','danger','example','question'].map(name=>block(name)),
 block('mark','forbidden'),block('highlight','forbidden',['color'],{color:'color'}),
 block('details'),
 block('tabs','optional',[],{},['tab']),
 child('tab',['tabs'],'required'),
 block('chat','optional',[],{},['message']),
 child('message',['chat'],'required',[],{sender:'string'}),
 block('flashcard','optional',[],{},['front','back']),
 child('front',['flashcard'],'forbidden'),child('back',['flashcard'],'forbidden'),
 block('glossary','optional',[],{},['definition']),
 child('definition',['glossary'],'required'),
 leaf('embed'),leaf('link-card',[],{title:'string'})
];
/** A name can have distinct inline and block definitions (mark/highlight). */
export const RMD_SCHEMA=new Map<string,RmdSchema>(list.map(value=>[value.type+':'+value.name,value]));
export const getRmdSchema=(type:RmdNodeType,name:string):RmdSchema|undefined=>RMD_SCHEMA.get(type+':'+name);
export const isRmdId=(id:string)=>/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(id);
export const attrsByBlock:Readonly<Record<string,Readonly<Record<string,RmdSchema['attributes'][string]>>>>={
 heading:{id:'id'},paragraph:{id:'id'},image:{id:'id',width:'integer',height:'integer',caption:'string'},
 math:{id:'id'},table:{id:'id',caption:'string'},code:{id:'id',file:'string',wrap:'boolean',expand:'boolean',},
 // Lists have no stable-ID NodeView yet; do not advertise a lossy modifier.

};
export function isValidRmdValue(kind:string,value:string):boolean{
 if(!value.trim())return false;
 if(kind==='integer')return /^\d+$/.test(value)&&Number(value)>=40&&Number(value)<=1800;
 if(kind==='boolean')return value==='true'||value==='false';
 if(kind==='color')return (RMD_COLORS as readonly string[]).includes(value);
 if(kind==='variant')return (RMD_VARIANTS as readonly string[]).includes(value);
 if(kind==='id')return isRmdId(value);
 return true;
}
