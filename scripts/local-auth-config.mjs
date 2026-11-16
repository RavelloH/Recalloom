import {readFileSync} from 'node:fs';

/** Normalize the effective key for existing local fixture parsers. */
export function readLocalAuthVars(){
 const source=readFileSync('.dev.vars','utf8');
 const main=/^\s*MAIN_SECRET\s*=(.*)$/m.exec(source);
 if(!main)return source;
 return source.replace(/^\s*MCP_AUTH_SECRET\s*=.*$/gm,'')+'\nMCP_AUTH_SECRET='+main[1]+'\n';
}
