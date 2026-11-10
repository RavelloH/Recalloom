/** Backward-compatible entry point. Actual checks use live TS command modules. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const runner=fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url));
const script=fileURLToPath(new URL('./audit-editor-syntax.ts',import.meta.url));
const child=spawnSync(process.execPath,[runner,script,...process.argv.slice(2)],{stdio:'inherit',cwd:process.cwd()});
if(child.error)throw child.error;
process.exit(child.status??1);
