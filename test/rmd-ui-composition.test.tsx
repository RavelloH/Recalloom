import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {EditableDetails,FlashcardSideTitle,RmdReadTooltip} from '../web/src/rmd-ui';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';

describe('RMD document UI composition',()=>{
 it('keeps the editable Details title outside its disclosure button and links mounted content',()=>{
  const html=renderToStaticMarkup(<EditableDetails label="详细说明"
   title={<span role="textbox" contentEditable suppressContentEditableWarning>详细说明</span>}>
    <div data-node-view-content=""><p>保留 <strong>正文</strong></p></div>
   </EditableDetails>);
  const button=html.match(/<button\b[\s\S]*?<\/button>/)?.[0];
  assert.ok(button,html);
  assert.match(button,/aria-expanded="true"/);
  assert.doesNotMatch(button,/contenteditable|role="textbox"/i);
  assert.match(html,/class="rk-details-title"><span role="textbox" contenteditable="true"/i);
  const controlled=button.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(controlled,html);
  assert.ok(html.includes('id="'+controlled+'" class="rk-details-content"'),html);
  assert.match(html,/<strong>正文<\/strong>/);
 });

 it('presents fixed flashcard side labels without exposing a title editing surface',()=>{
  const html=renderToStaticMarkup(<><FlashcardSideTitle side="front"/><FlashcardSideTitle side="back"/></>);
  assert.match(html,/>问题<\/div>/);
  assert.match(html,/>答案<\/div>/);
  assert.doesNotMatch(html,/contenteditable="true"|textbox|tabindex/i);
  const source=':::: flashcard 学习卡\n\n::: front\n\n**问题**\n\n:::\n\n::: back\n\n答案\n\n:::\n\n::::';
  const saved=serializeRmdVisual(parseRmdVisual(source));
  assert.match(saved,/::: front\n/);
  assert.match(saved,/::: back\n/);
  assert.doesNotMatch(saved,/::: (?:front|back) [^\n]/);
  assert.equal(serializeRmdVisual(parseRmdVisual(saved)),saved);
 });

 it('keeps read-only Tooltip anchors inline with description semantics instead of overriding their name',()=>{
  const html=renderToStaticMarkup(<p>解释 <RmdReadTooltip kind="abbr" description="中央处理器"><strong>CPU</strong></RmdReadTooltip>。</p>);
  assert.doesNotMatch(html,/<div|aria-label=|data-rk-tooltip=/);
  assert.match(html,/<span[^>]*tabindex="0"[^>]*aria-describedby="[^"]+"[^>]*><strong>CPU<\/strong><\/span>/);
  const empty=renderToStaticMarkup(<RmdReadTooltip kind="tooltip" description="">纯文字</RmdReadTooltip>);
  assert.doesNotMatch(empty,/tabindex|aria-describedby/);
 });
});
