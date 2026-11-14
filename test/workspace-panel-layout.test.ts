import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePanelLayout,PANEL_MIN_HEIGHT,PANEL_COLLAPSED_HEIGHT,PANEL_GAP,type PanelLayoutInput} from '../web/src/workspace-panel-layout';

const panel=(id:string,height:number,sequence=0):PanelLayoutInput=>({id,height,sequence});

test('panel layout keeps requested heights, puts short panels above tall ones, and aligns the bottom',()=>{
 const layout=calculatePanelLayout([panel('tall',320),panel('short',180),panel('middle',240)],900);
 assert.deepEqual(layout.map(({id,height})=>[id,height]),[['short',180],['middle',240],['tall',320]]);
 assert.equal(layout[0].top,140);
 assert.equal(layout.at(-1)!.top+layout.at(-1)!.height,900);
 assert.equal(layout[1].top-layout[0].top-layout[0].height,PANEL_GAP);
});

test('similar heights use opening sequence and have deterministic, immutable ordering',()=>{
 const panels=Object.freeze([Object.freeze(panel('old',200,1)),Object.freeze(panel('new',201,2)),Object.freeze(panel('equal',200,2))]);
 const layout=calculatePanelLayout(panels,900);
 assert.deepEqual(layout.map(({id})=>id),['new','equal','old']);
 assert.deepEqual(calculatePanelLayout(panels,900),layout);
 assert.deepEqual(calculatePanelLayout(panels,901).map(({id})=>id),layout.map(({id})=>id));
 assert.deepEqual(panels.map(({height})=>height),[200,201,200]);
});

test('panels shrink only by their space above the minimum before any collapse',()=>{
 const layout=calculatePanelLayout([panel('short',200),panel('tall',400)],430);
 assert.ok(layout.every(({collapsed})=>!collapsed));
 assert.ok(Math.abs(layout[0].height-174.28571428571428)<1e-8);
 assert.ok(Math.abs(layout[1].height-245.71428571428572)<1e-8);
 assert.ok(layout.every(({height})=>height>=PANEL_MIN_HEIGHT));
 assert.ok(Math.abs(layout.at(-1)!.top+layout.at(-1)!.height-430)<1e-8);
});

test('automatic collapse retains active and priority panels and places title bars first',()=>{
 const panels=[panel('old',250,1),{...panel('outline',250,0),priority:true},panel('new',250,3),panel('active',250,2)];
 const layout=calculatePanelLayout(panels,440,'active');
 assert.deepEqual(layout.filter(({collapsed})=>collapsed).map(({id,height})=>[id,height]),[['new',PANEL_COLLAPSED_HEIGHT],['old',PANEL_COLLAPSED_HEIGHT]]);
 assert.deepEqual(layout.filter(({collapsed})=>!collapsed).map(({id})=>id),['active','outline']);
 const smaller=calculatePanelLayout(panels,330,'active');
 assert.deepEqual(smaller.filter(({collapsed})=>!collapsed).map(({id})=>id),['active']);
});

test('explicit collapse is retained and space becoming available restores automatic collapse',()=>{
 const panels=[{...panel('manual',300),collapsed:true},panel('normal',300)];
 const small=calculatePanelLayout(panels,150);
 assert.ok(small.every(({collapsed})=>collapsed));
 const large=calculatePanelLayout(panels,500);
 assert.deepEqual(large.map(({id,height,collapsed})=>[id,height,collapsed]),[['manual',44,true],['normal',300,false]]);
});

test('all viewport sizes stay finite, nonnegative, nonoverlapping, and within the available height',()=>{
 const panels=[panel('first',300,1),panel('second',700,2),{...panel('outline',500),priority:true},panel('active',180,3)];
 for(const available of [0,1,25,44,80,150,200,350,600,1000,2400]){
  const layout=calculatePanelLayout(panels,available,'active');
  let end=0;
  for(const item of layout){
   assert.ok(Number.isFinite(item.top)&&Number.isFinite(item.height));
   assert.ok(item.top>=end-1e-8&&item.height>=0);
   end=item.top+item.height;
   assert.ok(end<=available+1e-8);
  }
  assert.ok(Math.abs(end-available)<1e-8);
 }
 assert.deepEqual(calculatePanelLayout([],300),[]);
 assert.ok(calculatePanelLayout([panel('invalid',NaN)],NaN).every(({top,height})=>top===0&&height===0));
});
