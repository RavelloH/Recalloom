import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePanelLayout,PANEL_MIN_HEIGHT,PANEL_COLLAPSED_HEIGHT,PANEL_STACK_PEEK,type PanelLayoutInput} from '../web/src/workspace-panel-layout';

const panel=(id:string,height:number,sequence=0):PanelLayoutInput=>({id,height,sequence});

test('cards overlap against a shared bottom and preserve independent requested heights',()=>{
 const layout=calculatePanelLayout([panel('tall',600),panel('short',400)],900);
 assert.deepEqual(layout,[
  {id:'short',top:500,height:400,collapsed:false,exposedHeight:400},
  {id:'tall',top:300,height:600,collapsed:false,exposedHeight:200}
 ]);
 assert.ok(layout.every(({top,height})=>top+height===900));
 assert.ok(layout.every(({collapsed})=>!collapsed),'the sum exceeding the viewport must not fold cards');
});

test('equal or similar cards put newer cards in front and raise rear cards to expose their headers',()=>{
 const panels=Object.freeze([Object.freeze(panel('old',400,1)),Object.freeze(panel('new',401,2)),Object.freeze(panel('equal',400,2))]);
 const layout=calculatePanelLayout(panels,900);
 assert.deepEqual(layout.map(({id,height,exposedHeight})=>[id,height,exposedHeight]),[
  ['new',401,401],['equal',465,PANEL_STACK_PEEK],['old',529,PANEL_STACK_PEEK]
 ]);
 assert.deepEqual(calculatePanelLayout(panels,900),layout);
 assert.deepEqual(calculatePanelLayout(panels,901).map(({id})=>id),layout.map(({id})=>id));
 assert.deepEqual(panels.map(({height})=>height),[400,401,400]);
});

test('viewport pressure reserves rear header space while keeping expanded minimums',()=>{
 const layout=calculatePanelLayout([panel('new',400,2),panel('old',400,1)],450);
 assert.deepEqual(layout.map(({height,collapsed})=>[height,collapsed]),[[386,false],[450,false]]);
 assert.equal(layout[1].exposedHeight,PANEL_STACK_PEEK);
 assert.ok(layout.every(({height})=>height>=PANEL_MIN_HEIGHT));
});

test('automatic folding happens only when minimum bodies and header strips cannot fit',()=>{
 const panels=[panel('old',250,1),{...panel('outline',250,0),priority:true},panel('new',250,3),panel('active',250,2)];
 assert.ok(calculatePanelLayout(panels,360,'active').every(({collapsed})=>!collapsed));
 const layout=calculatePanelLayout(panels,240,'active');
 assert.deepEqual(layout.filter(({collapsed})=>collapsed).map(({id})=>id),['new','old']);
 assert.deepEqual(layout.filter(({collapsed})=>!collapsed).map(({id})=>id),['active','outline']);
 const smaller=calculatePanelLayout(panels,200,'active');
 assert.deepEqual(smaller.filter(({collapsed})=>!collapsed).map(({id})=>id),['active']);
 assert.ok(smaller.at(-1)!.height>=PANEL_MIN_HEIGHT);
});

test('collapsed cards expose 44px strips and can include covered lower portions',()=>{
 const panels=[{...panel('manual-old',300,1),collapsed:true},{...panel('manual-new',300,2),collapsed:true},panel('normal',300)];
 const large=calculatePanelLayout(panels,500);
 assert.deepEqual(large.map(({id,height,exposedHeight,collapsed})=>[id,height,exposedHeight,collapsed]),[
  ['manual-new',44,PANEL_COLLAPSED_HEIGHT,true],['manual-old',88,PANEL_COLLAPSED_HEIGHT,true],['normal',300,212,false]
 ]);
 const small=calculatePanelLayout(panels,150);
 assert.ok(small.every(({collapsed})=>collapsed));
 assert.equal(calculatePanelLayout(panels,500).at(-1)!.collapsed,false,'automatic folding is not persisted into inputs');
});

test('every viewport keeps all bottoms equal with finite nonnegative heights and visible header strips',()=>{
 const panels=[panel('first',300,1),panel('second',700,2),{...panel('outline',500),priority:true},panel('active',180,3)];
 for(const available of [0,1,25,44,80,150,200,350,600,1000,2400]){
  const layout=calculatePanelLayout(panels,available,'active');
  let previousHeight=0;
  for(const item of layout){
   assert.ok(Number.isFinite(item.top)&&Number.isFinite(item.height));
   assert.ok(item.top>=0&&item.height>=previousHeight&&item.height<=available);
   assert.ok(Math.abs(item.top+item.height-available)<1e-8);
   assert.ok(Math.abs(item.exposedHeight-(item.height-previousHeight))<1e-8);
   if(available>0)assert.ok(item.exposedHeight>0);
   previousHeight=item.height;
  }
 }
 assert.deepEqual(calculatePanelLayout([],300),[]);
 assert.ok(calculatePanelLayout([panel('invalid',NaN)],NaN).every(({top,height})=>top===0&&height===0));
});
