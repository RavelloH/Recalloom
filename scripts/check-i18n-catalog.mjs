import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import zhRuntime from '@astryxdesign/core/locales/zh-CN.generated.js';

const authored=JSON.parse(readFileSync('node_modules/@astryxdesign/core/locales/zh-CN.json','utf8'));
const expected=Object.fromEntries(Object.entries(authored).map(([key,entry])=>[key,entry.defaultMessage]));
assert.deepEqual(zhRuntime,expected,'Official runtime locale must preserve every authored translation');
const entry=readFileSync('web/src/main.tsx','utf8');
assert.ok(entry.includes("from '@astryxdesign/core/locales/zh-CN.generated.js'"),
 'Bootstrap must consume the runtime catalog, not the full translator catalog');
assert.ok(!entry.includes("from '@astryxdesign/core/locales/zh-CN.json'"),
 'Do not ship translator descriptions in the app entry');
console.log('Astryx zh-CN runtime verified: '+Object.keys(expected).length+' identical messages, no authoring metadata in bootstrap');
