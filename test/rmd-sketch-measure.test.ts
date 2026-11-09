import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {groupSketchLineBounds,type SketchBounds} from '../web/src/sketch-measure';
import {SKETCH_DEFAULT_COLORS,SKETCH_KINDS,SKETCH_PALETTE,sketchPaths} from '../web/src/sketch-geometry';
import {RMD_COLORS} from '../web/src/rmd-schema';

const bounds=(left:number,top:number,width:number,height:number):SketchBounds=>({
 left,top,right:left+width,bottom:top+height
});
const ys=(path:string):number[]=>{
 const numbers=(path.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
 return numbers.filter((_,index)=>index%2===1);
};
describe('static sketch geometry measurement',()=>{
 it('joins text and KaTeX fragments on the same visual line into a single mark',()=>{
  const lines=groupSketchLineBounds([
   bounds(100,60,63,19), // ordinary text
   bounds(163,59.5,62,20), // immediately adjacent KaTeX span
   bounds(225,60,72,19) // trailing text
  ]);
  assert.equal(lines.length,1);
  assert.equal(lines[0]?.left,100);
  assert.equal(lines[0]?.right,297);
  assert.equal(lines[0]?.top,59.5);
  assert.equal(lines[0]?.bottom,79.5);
 });
 it('keeps actual wrapped lines separate, even when an inline tag has multiple DOM fragments',()=>{
  const lines=groupSketchLineBounds([
   bounds(80,40,230,19),
   bounds(80,68,105,19),
   bounds(185,68,85,20),
   bounds(270,68,50,19),
  ]);
  assert.equal(lines.length,2);
  assert.deepEqual(lines.map(x=>({left:x.left,right:x.right})),[{left:80,right:310},{left:80,right:320}]);
 });
 it('expands math highlighter to visible glyph height without changing ordinary text highlight',()=>{
  const math=sketchPaths('highlight',145,48,7,1,true)[0];
  const normal=sketchPaths('highlight',145,48,7,1,false)[0];
  assert.ok(math?.fill&&normal?.fill);
  const mathY=ys(math!.d),textY=ys(normal!.d);
  assert.ok(Math.min(...mathY)<=4&&Math.max(...mathY)>=44,math!.d);
  assert.ok(Math.min(...textY)>7&&Math.max(...textY)<45,normal!.d);
  assert.notEqual(math!.d,normal!.d);
  assert.deepEqual(sketchPaths('highlight',145,48,7,1,true),sketchPaths('highlight',145,48,7,1,true));
 });
 it('keeps schema color names and renderer palette in sync',()=>{
  assert.deepEqual(Object.keys(SKETCH_PALETTE).sort(),[...RMD_COLORS].sort());
  assert.equal(Object.keys(SKETCH_DEFAULT_COLORS).length,SKETCH_KINDS.length);
  assert.ok(Object.values(SKETCH_DEFAULT_COLORS).every(key=>Object.hasOwn(SKETCH_PALETTE,key)));
 });
});
