/** RMD 1.0 runtime schema.
 * Registry: src/rmd/registry.json — shared by lexer, rendered help and
 * CodeMirror source completions. Do not hand-maintain parallel component maps.
 */
import registry from '../../src/rmd/registry.json';

export type RmdNodeType='inline'|'block'|'leaf';
export type RmdValueType='string'|'boolean'|'integer'|'color'|'variant'|'id';
export type RmdSchema={
 name:string;type:RmdNodeType;main:'required'|'optional'|'forbidden';
 positions:readonly string[];attributes:Readonly<Record<string,RmdValueType>>;
 allowedParents?:readonly string[];children?:readonly string[];
 orderedChildren?:readonly string[];requiredAttributes?:readonly string[];
};
export const RMD_REGISTRY=registry;
export const RMD_COLORS:readonly string[]=registry.colors;
export const RMD_VARIANTS:readonly string[]=registry.variants;

const definitions=registry.components.map(component=>({
 name:component.name,
 type:component.type,
 main:component.main,
 positions:component.positions,
 attributes:component.attributes,
 ...('allowedParents'in component?{allowedParents:component.allowedParents}:{}),
 ...('children'in component?{children:component.children}:{}),
 ...('orderedChildren'in component?{orderedChildren:component.orderedChildren}:{}),
 ...('requiredAttributes'in component?{requiredAttributes:component.requiredAttributes}:{})
}) as unknown as RmdSchema);
/** The key includes syntax form; Mark and Highlight have both forms. */
export const RMD_SCHEMA=new Map<string,RmdSchema>(
 definitions.map(item=>[item.type+':'+item.name,item])
);
export const getRmdSchema=(type:RmdNodeType,name:string):RmdSchema|undefined=>
 RMD_SCHEMA.get(type+':'+name);

const idPattern=new RegExp(registry.constraints.idPattern);
export const isRmdId=(id:string)=>idPattern.test(id);
export const attrsByBlock:Readonly<Record<string,Readonly<Record<string,RmdValueType>>>>=
 registry.nodes.reduce<Record<string,Readonly<Record<string,RmdValueType>>>>(
  (out,node)=>{out[node.node]=node.attributes as unknown as Record<string,RmdValueType>;return out;},{});

export function isValidRmdValue(kind:string,value:string):boolean{
 if(!value.trim())return false;
 if(kind==='integer')return /^\d+$/.test(value)&&Number(value)>=registry.constraints.integerMinimum&&Number(value)<=registry.constraints.integerMaximum;
 if(kind==='boolean')return value==='true'||value==='false';
 if(kind==='color')return RMD_COLORS.includes(value);
 if(kind==='variant')return RMD_VARIANTS.includes(value);
 if(kind==='id')return isRmdId(value);
 return true;
}
