// Local-only helper. Never send the OAuth master secret to the browser.
// Output is a purpose-limited Web login credential, not the OAuth secret.
import { createHmac } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { stdin,stdout } from 'node:process';

async function readMasterSecret(){
  if(process.env.MCP_AUTH_SECRET)return process.env.MCP_AUTH_SECRET;
  if(!stdin.isTTY)throw Error('Run from an interactive terminal, or supply MCP_AUTH_SECRET through the process environment.');
  stdout.write('Enter MCP_AUTH_SECRET (input hidden): ');
  return new Promise((resolve,reject)=>{
    let text='';
    const clear=()=>{
      stdin.off('keypress',keyPress);
      stdin.setRawMode(false);stdin.pause();stdout.write('\n');
    };
    function keyPress(str,key){
      if(key?.ctrl&&key.name==='c'){clear();reject(Error('Cancelled'));return;}
      if(key?.name==='return'||key?.name==='enter'){clear();resolve(text);return;}
      if(key?.name==='backspace'){text=text.slice(0,-1);return;}
      if(typeof str==='string'&&!key?.ctrl&&str>=' ')text+=str;
    }
    emitKeypressEvents(stdin);stdin.setRawMode(true);stdin.resume();stdin.on('keypress',keyPress);
  });
}
try{
  const master=await readMasterSecret();
  if(!master||master==='replace-with-a-random-secret')throw Error('MCP_AUTH_SECRET is missing or contains the example placeholder.');
  if(master.length<32)console.error('Warning: the existing OAuth secret is shorter than 32 characters. Consider rotating it to a high-entropy random secret when practical.');
  const webKey=createHmac('sha256',master).update('recalloom:web:v1:login').digest('base64url');
  stdout.write('Derived Web login credential (keep private; enter this in the Web login form):\n'+webKey+'\n');
}catch(error){
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}
