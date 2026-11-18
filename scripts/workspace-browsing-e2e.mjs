import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readLocalAuthVars } from './local-auth-config.mjs';

const base = process.env.RECALLOOM_TEST_BASE;
assert.match(base ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const secret = readLocalAuthVars().match(/^\s*MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
assert.ok(secret);
const executablePath = [process.env.RECALLOOM_BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const response = await fetch('/api' + path, { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(path + ': ' + response.status);
  return response.json();
}, { path, method, body });

try {
  await page.goto(base + '/login');
  await page.getByPlaceholder('输入授权密钥').fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(base + '/');
  const folder = await api('/folders', 'POST', { name: '浏览验收甲目录' });
  const secondFolder = await api('/folders', 'POST', { name: '浏览验收乙目录' });
  const make = (name, folderId, content = '# Note') => api('/records', 'POST', { name, folderId, content });
  const first = await make('README.md', folder.id, '# Context heading\n\n' + '一段前置的研究描述。\n\n'.repeat(10) + '这里是浏览验证命中词。\n\n结尾仍然保留。');
  await make('README.md', secondFolder.id);
  await make('alpha README.md', folder.id);
  const query = '/folders?parentId=' + folder.id + '&sort=name&query=readme&limit=1';
  const sorted = await api(query);
  assert.equal(sorted.items[0].name, 'alpha README.md');
  assert.equal((await api(query + '&cursor=' + encodeURIComponent(sorted.page.nextCursor))).items[0].id, first.id);

  await page.goto(base + '/library/' + folder.id);
  await page.getByRole('textbox', { name: '搜索当前目录' }).fill('ALPHA');
  await page.locator('.file-table').getByRole('link', { name: /alpha README/i }).waitFor();
  await page.locator('.file-table .file-row').filter({ hasText: 'README' }).filter({ hasNotText: 'alpha' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件夹' }).waitFor();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/search?q=' + encodeURIComponent('浏览验证命中词') + '&mode=literal');
  await page.locator('.search-result-path').filter({ hasText: folder.name }).waitFor();
  await page.waitForFunction(() => {
    const preview = document.querySelector('.search-snippet[data-offset]');
    const mark = preview?.querySelector('.search-highlight');
    if (!preview || !mark) return false;
    const box = preview.getBoundingClientRect(), hit = mark.getBoundingClientRect();
    return hit.top >= box.top + 16 && hit.bottom <= box.bottom - 48;
  });
  await page.getByRole('button', { name: '展开片段' }).click();
  await page.locator('.search-snippet[data-expanded] .markdown-preview[data-embedded]').waitFor();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/');
  if (await page.getByRole('radio', { name: '最近更新' }).getAttribute('aria-checked') !== 'true')
    await page.getByRole('radio', { name: '最近更新' }).click();
  await page.locator('.recent-page-location').filter({ hasText: folder.name }).waitFor();
  await page.locator('.recent-page-location').filter({ hasText: secondFolder.name }).waitFor();

  await api('/records/' + first.id + '/meta', 'PATCH', { expectedMetadataRevision: 1, status: 'archived' });
  await page.goto(base + '/archive');
  const actions = page.locator('.archive-item').filter({ hasText: folder.name }).locator('.archive-row-actions');
  await actions.getByRole('button', { name: '恢复', exact: true }).waitFor();
  const actionBounds = await actions.evaluate(el => {
    const { left, right, width } = el.getBoundingClientRect();
    return { left, right, width, columnWidth: el.parentElement.getBoundingClientRect().width,
      children: [...el.children].map(child => { const bounds = child.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, width: bounds.width }; }).filter(child => child.width > 0) };
  });
  assert.ok(actionBounds.children.length >= 2 && actionBounds.children.every(child => child.left >= actionBounds.left - 1 && child.right <= actionBounds.right + 1), 'Archive actions fit their column: ' + JSON.stringify(actionBounds));
  console.log('Workspace browsing PASS — directory paging, mobile search hit, duplicate home paths, and archive actions');
} finally {
  await browser.close();
}
