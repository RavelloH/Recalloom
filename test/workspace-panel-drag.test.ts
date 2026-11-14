import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePanelDrag} from '../web/src/workspace-panel-drag';

test('diagonal dragging applies both axes and preserves the bottom edge',()=>{
 assert.deepEqual(calculatePanelDrag({dx:320,dy:-80,height:300,top:200}),{dx:320,dy:-80,height:380,top:120});
});

test('right motion is unlimited and left motion approaches a 24px resistance bound',()=>{
 assert.equal(calculatePanelDrag({dx:10000,dy:0,height:300,top:200}).dx,10000);
 assert.equal(calculatePanelDrag({dx:-64,dy:0,height:300,top:200}).dx,-12);
 const far=calculatePanelDrag({dx:-10000,dy:40,height:300,top:200});
 assert.ok(far.dx>-24&&far.dx<-23);
 assert.equal(far.dy,40);
});

test('vertical motion stops at the rail top and expanded minimum height',()=>{
 assert.deepEqual(calculatePanelDrag({dx:80,dy:-1000,height:300,top:200}),{dx:80,dy:-200,height:500,top:0});
 assert.deepEqual(calculatePanelDrag({dx:80,dy:1000,height:300,top:200}),{dx:80,dy:140,height:160,top:340});
 assert.equal(calculatePanelDrag({dx:0,dy:90,height:100,top:0}).height,100);
});

test('horizontal motion keeps collapsed bars at 64px and custom minimums are respected',()=>{
 assert.equal(calculatePanelDrag({dx:100,dy:0,height:64,top:300,collapsed:true}).height,64);
 assert.equal(calculatePanelDrag({dx:100,dy:100,height:64,top:300,collapsed:true}).dy,0);
 assert.equal(calculatePanelDrag({dx:0,dy:200,height:300,top:100,minHeight:200}).height,200);
});
