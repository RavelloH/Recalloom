import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionLabel} from '../web/src/session-label.js';

test('session labels identify the browser before its compatibility tokens',()=>{
 assert.deepEqual(sessionLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/157.0 Safari/537.36 Edg/157.0'),{platform:'Windows',browser:'Edge'});
 assert.deepEqual(sessionLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1 Version/27.0 Mobile/15E148 Safari/604.1'),{platform:'iPhone',browser:'Safari'});
 assert.deepEqual(sessionLabel('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/157.0 Mobile/15E148 Safari/604.1'),{platform:'iPad',browser:'Chrome'});
 assert.deepEqual(sessionLabel(''),{platform:'未知设备',browser:'未知浏览器'});
});
