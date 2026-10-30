import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';

const browserBin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const keyLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(s=>/^\s*MCP_AUTH_SECRET\s*=/.test(s));
assert.ok(browserBin&&keyLine,'Local browser and .dev.vars are required');
const secret=keyLine.slice(keyLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const origin='http://127.0.0.1:8897',browser=await chromium.launch({executablePath:browserBin,headless:true});
const page=await browser.newPage({viewport:{width:1230,height:850}});
const source=async()=>{
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 await page.locator('.cm-line').first().waitFor();
 return(await page.locator('.cm-line').allTextContents()).join('\n');
};
const back=async()=>{
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap').waitFor();
};
const load=async markdown=>{
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 await page.locator('.cm-content').fill(markdown);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await back();
};
try{
 await page.goto(origin+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/');
 await page.goto(origin+'/library');
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('Editor interactions '+Date.now());
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByRole('heading',{name:/Editor interactions/}).waitFor();

 // Insert and edit an existing Markdown link, preserving the display text.
 await page.locator('.tiptap').click();
 await page.getByRole('button',{name:'插入或编辑链接'}).click();
 const linkDialog=page.getByRole('dialog',{name:'插入链接'});
 await linkDialog.getByRole('textbox',{name:'链接文字'}).fill('文档链接');
 await linkDialog.getByRole('textbox',{name:'链接地址'}).fill('https://example.com/docs');
 await linkDialog.getByRole('button',{name:'插入',exact:true}).click();
 let md=await source();
 assert.ok(md.includes('[文档链接](https://example.com/docs)'),'link insertion: '+md);
 await back();
 await page.locator('.tiptap a').click();
 await page.getByRole('button',{name:'插入或编辑链接'}).click();
 const editLink=page.getByRole('dialog',{name:'编辑链接'});
 await editLink.getByRole('textbox',{name:'链接地址'}).fill('https://example.org/new');
 await editLink.getByRole('button',{name:'更新',exact:true}).click();
 md=await source();
 assert.ok(md.includes('https://example.org/new'),'link update: '+md);
 await back();
 await page.locator('.tiptap a').click();
 await page.getByRole('button',{name:'插入或编辑链接'}).click();
 await page.getByRole('dialog',{name:'编辑链接'}).getByRole('button',{name:'删除链接'}).click();
 md=await source();
 assert.ok(md.includes('文档链接')&&!md.includes('https://example.org/new'),'link removal keeps text: '+md);

 // External image insertion, alt edit, removal and protocol validation.
 await back();
 await page.getByRole('button',{name:'插入或编辑图片'}).click();
 const imageDialog=page.getByRole('dialog',{name:'插入图片'});
 await imageDialog.getByRole('textbox',{name:'图片地址'}).fill('ftp://example.com/image.png');
 assert.equal(await imageDialog.getByRole('button',{name:'插入',exact:true}).isDisabled(),true);
 await imageDialog.getByRole('textbox',{name:'图片地址'}).fill('https://example.com/pic.png');
 await imageDialog.getByRole('textbox',{name:'替代文本（Alt）'}).fill('演示图片');
 await imageDialog.getByRole('button',{name:'插入',exact:true}).click();
 md=await source();
 assert.ok(md.includes('![演示图片](https://example.com/pic.png)'),'image insertion: '+md);
 await back();
 await page.locator('.tiptap img').click();
 await page.getByRole('button',{name:'插入或编辑图片'}).click();
 const editImage=page.getByRole('dialog',{name:'编辑图片'});
 await editImage.getByRole('textbox',{name:'替代文本（Alt）'}).fill('更新的图片描述');
 await editImage.getByRole('button',{name:'更新',exact:true}).click();
 md=await source();
 assert.ok(md.includes('更新的图片描述'),'image alt update: '+md);
 await back();
 await page.locator('.tiptap img').click();
 await page.getByRole('button',{name:'插入或编辑图片'}).click();
 await page.getByRole('dialog',{name:'编辑图片'}).getByRole('button',{name:'删除图片'}).click();
 md=await source();
 assert.ok(!md.includes('pic.png'),'image removal: '+md);

 // Insertion, KaTeX live preview, and update of existing inline formula.
 await back();
 await page.locator('.tiptap').click();
 await page.getByRole('button',{name:'插入行内公式'}).click();
 const mathDialog=page.getByRole('dialog',{name:'插入数学公式'});
 await mathDialog.getByRole('textbox',{name:'LaTeX 公式'}).fill('E=mc^2');
 await mathDialog.locator('.katex').first().waitFor();
 await mathDialog.getByRole('button',{name:'插入',exact:true}).click();
 md=await source();
 assert.ok(md.includes('$E=mc^2$'),'inline formula insertion: '+md);
 await back();
 await page.locator('.tiptap .katex').first().click();
 const editMath=page.getByRole('dialog',{name:'编辑数学公式'});
 await editMath.getByRole('textbox',{name:'LaTeX 公式'}).fill('F=ma');
 await editMath.getByRole('button',{name:'更新',exact:true}).click();
 md=await source();
 assert.ok(md.includes('$F=ma$'),'inline formula edit: '+md);

 // GFM tables: correct selected column plus add/remove rows and columns.
 await load('| Left | Right |\n| :--- | ---: |\n| Cell | 42 |');
 await page.locator('.tiptap').focus();
 await page.locator('.tiptap table tr:last-child td:first-child').click();
 await page.getByRole('toolbar',{name:'表格操作'}).waitFor();
 await page.getByRole('button',{name:'当前列居中对齐'}).click();
 md=await source();
 assert.match(md,/\|\s*:------:\s*\|\s*-------:\s*\|/,'first selected column aligned: '+md);
 await back();
 await page.locator('.tiptap').focus();
 await page.locator('.tiptap table tr:last-child td:first-child').click();
 await page.getByRole('button',{name:'在下方插入行'}).click();
 assert.equal(await page.locator('.tiptap table tr').count(),3,'row added');
 await page.getByRole('button',{name:'在后方插入列'}).click();
 assert.equal(await page.locator('.tiptap table tr:first-child th').count(),3,'column added');
 await page.getByRole('button',{name:'删除当前列'}).click();
 assert.equal(await page.locator('.tiptap table tr:first-child th').count(),2,'column removed');

 // Avoid horizontal overflow when running on a narrow touch viewport.
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.addCookies(await page.context().cookies());
 const phone=await mobile.newPage();
 await phone.goto(page.url(),{waitUntil:'networkidle'});
 await phone.locator('.wysiwyg-toolbar').waitFor();
 const geometry=await phone.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert.ok(geometry.page<=geometry.viewport,'mobile toolbars must not overflow: '+JSON.stringify(geometry));
 await mobile.close();
 console.log('PASS Tiptap link/image/math/table interactions and mobile toolbar');
}finally{await browser.close();}
