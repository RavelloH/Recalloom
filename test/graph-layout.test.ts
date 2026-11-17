import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {arrangeGraph,mergeGraphNodes,visibleGraphEdges} from '../web/src/graph-layout.js';
import type {KnowledgeNode,KnowledgeEdge} from '../web/src/graph-types.js';

const nodes:KnowledgeNode[]=Array.from({length:80},(_,index)=>({id:'doc-'+String(index).padStart(3,'0'),name:'文稿 '+index,
 kind:'document',status:'active',folderId:'folder-'+index%5,folderName:'目录',updatedAt:'2026-11-15',revision:1}));
const edge=(from:number,to:number,type:KnowledgeEdge['type']='explicit',score=.9):KnowledgeEdge=>({
 id:type+':'+from+':'+to,sourceId:nodes[from].id,targetId:nodes[to].id,type,relation:'related',score
});

describe('knowledge graph exploration layout',()=>{
 it('adapts the aspect ratio without compressing nodes into each other',()=>{
  for(const viewport of [{width:1100,height:600},{width:360,height:470}]){
   const result=arrangeGraph(nodes,[edge(0,1),edge(2,0)],nodes[0].id,viewport);
   assert.deepEqual(result.positions.get(nodes[0].id),{x:0,y:0});
   const points=[...result.positions.values()];
   for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)
    assert.ok(Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y)>40,'Model-space nodes stay separated');
   const width=Math.max(...points.map(point=>Math.abs(point.x)))*2;
   const height=Math.max(...points.map(point=>Math.abs(point.y)))*2;
   assert.ok(Math.abs(width/height-(viewport.width-160)/(viewport.height-140))<.001,'World layout follows the canvas aspect ratio');
  }
 });
 it('keeps every background document while centering incoming and outgoing neighbors',()=>{
  const result=arrangeGraph(nodes,[edge(0,1),edge(2,0),edge(0,3,'semantic')],nodes[0].id);
  assert.deepEqual(result.positions.get(nodes[0].id),{x:0,y:0});
  assert.equal(result.positions.size,nodes.length);
  assert.deepEqual([...result.neighbors].sort(),[nodes[1].id,nodes[2].id,nodes[3].id]);
  for(const node of nodes.slice(1)){
   const point=result.positions.get(node.id)!;const distance=Math.hypot(point.x,point.y);
   assert.ok(result.neighbors.has(node.id)?distance<200:distance>=310);
  }
 });
 it('keeps isolated centers and deterministic positions independent of response order',()=>{
  const first=arrangeGraph(nodes,[],nodes[4].id),second=arrangeGraph([...nodes].reverse(),[],nodes[4].id);
  assert.equal(first.positions.size,80);assert.equal(first.neighbors.size,0);
  for(const [id,position] of first.positions)assert.deepEqual(position,second.positions.get(id));
  const points=[...first.positions.values()];
  for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)
   assert.ok(Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y)>40,'Background nodes do not overlap');
 });
 it('retains previously visited nodes and refreshes their metadata',()=>{
  const changed={...nodes[0],name:'已更新的标题',revision:2};
  const merged=mergeGraphNodes(nodes.slice(0,3),[changed,nodes[4]]);
  assert.equal(merged.length,4);assert.equal(merged.find(node=>node.id===changed.id),changed);
  assert.ok(merged.some(node=>node.id===nodes[1].id));
 });
 it('limits and deduplicates semantic edges without suppressing confirmed links',()=>{
  const confirmed=edge(0,1),suggestions=nodes.slice(1,20).map((_,index)=>edge(0,index+1,'semantic',.99-index/100));
  const reverse={...edge(1,0,'semantic'),score:1};
  const visible=visibleGraphEdges([confirmed,...suggestions,reverse],true,nodes[0].id);
  assert.ok(visible.some(item=>item.id===confirmed.id));
  assert.equal(visible.filter(item=>item.type==='semantic').length,8);
  assert.ok(!visible.some(item=>item.type==='semantic'&&(item.sourceId===nodes[1].id||item.targetId===nodes[1].id)));
  assert.deepEqual(visibleGraphEdges([confirmed,...suggestions],false),[confirmed]);
  const folder=edge(0,2,'folder'),semantic=edge(0,2,'semantic');
  assert.deepEqual(visibleGraphEdges([folder,semantic],true),[semantic],'Directory fallback must not hide semantic similarity');
  assert.deepEqual(visibleGraphEdges([folder,semantic],false),[folder]);
 });
});
