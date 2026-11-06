/** Browser testing is local-only; prefer the OS headless shell on Linux. */
import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';

const candidates=[
 process.env.CHROMIUM_PATH,
 '/usr/bin/chromium-headless-shell',
 '/usr/bin/chromium',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
export const browserBin=candidates.find(existsSync);
export const testOrigin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(testOrigin))
 throw new Error('Browser fixtures may run only against a 127.0.0.1 development server');
export function launchTestBrowser(){
 if(!browserBin)throw new Error('No supported local headless browser installed');
 return chromium.launch({executablePath:browserBin,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
}
