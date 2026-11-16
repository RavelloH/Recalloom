import type {Env} from './types.js';

/** A configured MAIN_SECRET takes precedence, including an invalid empty value. */
export function mainSecret(env:Pick<Env,'MAIN_SECRET'|'MCP_AUTH_SECRET'>):string{
 const value=env.MAIN_SECRET??env.MCP_AUTH_SECRET;
 return typeof value==='string'?value:'';
}

export function hasMainSecret(env:Env){
 const value=mainSecret(env);
 return value.length>0&&value!=='replace-with-a-random-secret';
}
