import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from '@tiptap/core';
import {runWithTextSelection} from '../web/src/tiptap/editor-command-menu';

describe('context menu selection restoration',()=>{
 it('restores the captured range before executing a menu command',()=>{
  const calls:unknown[]=[];
  const editor={
   state:{doc:{content:{size:50}}},
   commands:{setTextSelection:(range:{from:number;to:number})=>{calls.push(['selection',range]);return true;}}
  } as unknown as Editor;
  const result=runWithTextSelection(editor,{from:4,to:18},()=>{calls.push(['command']);return 'done';});
  assert.equal(result,'done');
  assert.deepEqual(calls,[['selection',{from:4,to:18}],['command']]);
 });
 it('does not apply an empty, reversed or out-of-range selection',()=>{
  const calls:string[]=[];
  const editor={
   state:{doc:{content:{size:10}}},
   commands:{setTextSelection:()=>{calls.push('selection');return true;}}
  } as unknown as Editor;
  for(const range of [{from:4,to:4},{from:8,to:2},{from:0,to:11}])
   runWithTextSelection(editor,range,()=>{calls.push('command');});
  assert.deepEqual(calls,['command','command','command']);
 });
});
