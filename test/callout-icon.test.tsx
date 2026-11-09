import React from 'react';
import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {calloutIcon} from '../web/src/callout-icon';

const kinds=['note','info','tip','success','warning','danger','example','question'] as const;
describe('RMD semantic Callout icon conventions',()=>{
 it('provides eight Tabler glyphs with shared control dimensions and stroke',()=>{
  const glyphs=new Set<string>();
  for(const kind of kinds){
   const html=renderToStaticMarkup(<>{calloutIcon(kind)}</>);
   assert.match(html,/class="[^"]*tabler-icon/,'Tabler icon: '+kind);
   assert.match(html,/width="var\(--rk-icon-sm\)"/,'16px shared icon token: '+kind);
   assert.match(html,/height="var\(--rk-icon-sm\)"/,'16px shared icon token: '+kind);
   assert.match(html,/stroke-width="2"/,'uniform outline: '+kind);
   glyphs.add(html.match(/tabler-icon-([a-z-]+)/)?.[1]??'');
  }
  assert.equal(glyphs.size,kinds.length,'each kind needs its own semantic glyph');
 });
 it('uses a distinct danger glyph rather than the warning triangle or security shield',()=>{
  const danger=renderToStaticMarkup(<>{calloutIcon('danger')}</>);
  const warning=renderToStaticMarkup(<>{calloutIcon('warning')}</>);
  assert.match(danger,/tabler-icon-alert-octagon/);
  assert.match(warning,/tabler-icon-alert-triangle/);
  assert.equal(calloutIcon('unknown'),undefined);
 });
});
