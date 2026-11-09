import React from 'react';
import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {getIcon} from '@astryxdesign/core/Icon';
import {recalloomTheme} from '../web/src/icon-theme';

const semanticKeys=[
 'close','chevronDown','chevronLeft','chevronRight','chevronsLeft','chevronsRight',
 'check','success','error','warning','info','calendar','clock','externalLink',
 'menu','moreHorizontal','search','upload','arrowUp','arrowDown','arrowsUpDown',
 'funnel','eyeSlash','viewColumns','copy','checkDouble','wrench','stop','microphone'
] as const;

describe('Recalloom Astryx icon registry',()=>{
 it('preserves neutral theme tokens while replacing every built-in glyph with Tabler',()=>{
  assert.equal(recalloomTheme.name,'neutral');
  assert.equal(semanticKeys.length,29);
  for(const key of semanticKeys){
   const rendered=renderToStaticMarkup(React.createElement(React.Fragment,null,getIcon(key,recalloomTheme)));
   assert.match(rendered,/\btabler-icon\b/,'expected Tabler for '+key);
   assert.doesNotMatch(rendered,/\blucide\b/,'legacy Lucide rendered for '+key);
   assert.match(rendered,/width="var\(--rk-icon-sm\)"/,'shared component icon width needed for '+key);
   assert.match(rendered,/height="var\(--rk-icon-sm\)"/,'shared component icon height needed for '+key);
   assert.match(rendered,/stroke-width="2"/,'consistent outline needed for '+key);
  }
 });
});
