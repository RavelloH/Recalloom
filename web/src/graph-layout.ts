import type {KnowledgeEdge,KnowledgeNode} from './graph-types';

export type GraphPoint={x:number;y:number};
export type GraphArrangement={positions:Map<string,GraphPoint>;neighbors:Set<string>};
const order=(a:KnowledgeNode,b:KnowledgeNode)=>(a.folderId??'').localeCompare(b.folderId??'')||a.id.localeCompare(b.id);

/** Rendering-independent positions, shared by overview and local exploration.
 * Ring capacity grows with circumference; background nodes never disappear. */
export function arrangeGraph(nodes:KnowledgeNode[],edges:KnowledgeEdge[],focusId?:string,viewport?:{width:number;height:number}):GraphArrangement{
 const positions=new Map<string,GraphPoint>(),neighbors=new Set<string>(),byId=new Map(nodes.map(node=>[node.id,node]));
 const rings=(items:KnowledgeNode[],startRadius:number,spacing:number)=>{
  let offset=0,radius=startRadius,ring=0;
  while(offset<items.length){
   const count=Math.min(items.length-offset,Math.max(6,Math.floor(2*Math.PI*radius/spacing)));
   for(let index=0;index<count;index++){
    const angle=-Math.PI/2+2*Math.PI*(index+(ring%2)*.5)/count;
    positions.set(items[offset+index].id,{x:radius*Math.cos(angle),y:radius*Math.sin(angle)});
   }
   offset+=count;radius+=92;ring++;
  }
  return radius-92;
 };
 if(focusId&&byId.has(focusId)){
  const weights=new Map<string,number>();
  for(const edge of edges){
   const other:string|null=edge.sourceId===focusId?edge.targetId:edge.targetId===focusId?edge.sourceId:null;
   if(!other||other===focusId||!byId.has(other))continue;
   const weight=edge.type==='semantic'?2+(edge.score??0):edge.type==='folder'?1:4;
   weights.set(other,Math.max(weights.get(other)??0,weight));neighbors.add(other);
  }
  const related=nodes.filter(node=>neighbors.has(node.id)).sort((a,b)=>(weights.get(b.id)??0)-(weights.get(a.id)??0)||order(a,b));
  positions.set(focusId,{x:0,y:0});
  const innerRadius=rings(related,165,132);
  rings(nodes.filter(node=>node.id!==focusId&&!neighbors.has(node.id)).sort(order),Math.max(310,innerRadius+150),61);
 }else{
  // Keep documents from one folder adjacent without introducing fictitious edges.
  rings([...nodes].sort(order),nodes.length<=8?125:180,100);
 }
 // Match the available rectangle while preserving concentric relationship tiers.
 // Reserve room for node bodies, labels and the bottom canvas controls.
 if(viewport&&positions.size){
  const width=Math.max(120,viewport.width-160),height=Math.max(100,viewport.height-140);
  const points=[...positions.values()];
  const radiusX=Math.max(1,...points.map(point=>Math.abs(point.x))),radiusY=Math.max(1,...points.map(point=>Math.abs(point.y)));
  const scaleX=width/(2*radiusX),scaleY=height/(2*radiusY);
  for(const [id,point] of positions)positions.set(id,{x:point.x*scaleX,y:point.y*scaleY});
 }
 return {positions,neighbors};
}

/** Reconcile independent metadata/semantic requests without losing visited nodes.
 * Current responses win over retained metadata. No coordinates live in API data. */
export function mergeGraphNodes(retained:KnowledgeNode[],...groups:Array<KnowledgeNode[]|undefined>){
 const nodes=new Map(retained.map(node=>[node.id,node]));
 for(const group of groups)for(const node of group??[])nodes.set(node.id,node);
 return [...nodes.values()];
}

export function visibleGraphEdges(edges:KnowledgeEdge[],semantic:boolean,focusId?:string){
 const result=new Map<string,KnowledgeEdge>(),degrees=new Map<string,number>();
 const confirmed=edges.filter(edge=>edge.type!=='semantic');
 const pairs=new Set(confirmed.filter(edge=>edge.type!=='folder').map(edge=>[edge.sourceId,edge.targetId].sort().join(':')));
 const folderEdges=new Map<string,string[]>();
 for(const edge of confirmed.filter(edge=>edge.type==='folder')){
  const pair=[edge.sourceId,edge.targetId].sort().join(':');folderEdges.set(pair,[...folderEdges.get(pair)??[],edge.id]);
 }
 for(const edge of confirmed)result.set(edge.id,edge);
 if(semantic)for(const edge of edges.filter(edge=>edge.type==='semantic').sort((a,b)=>(b.score??0)-(a.score??0))){
  const pair=[edge.sourceId,edge.targetId].sort().join(':');
  const cap=edge.sourceId===focusId||edge.targetId===focusId?8:4;
  if(pairs.has(pair)||(degrees.get(edge.sourceId)??0)>=cap||(degrees.get(edge.targetId)??0)>=cap)continue;
  pairs.add(pair);result.set(edge.id,edge);
  for(const id of folderEdges.get(pair)??[])result.delete(id);
  for(const id of [edge.sourceId,edge.targetId])degrees.set(id,(degrees.get(id)??0)+1);
 }
 return [...result.values()];
}
