import {copyFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'web/public/cap-wasm');
mkdirSync(target,{recursive:true});
for(const name of ['cap_wasm_bg.wasm','hashwx.wasm'])copyFileSync(resolve(root,'node_modules/@cap.js/wasm/browser',name),resolve(target,name));
console.log('Staged local Cap.js WASM assets');
