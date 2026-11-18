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
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const response = await fetch('/api' + path, { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  assertResponse(response.ok, response.status, data);
  return data;
  function assertResponse(ok, status, value) { if (!ok) throw Error(`${path}: ${status} ${JSON.stringify(value)}`); }
}, { path, method, body });

try {
  await page.goto(base + '/login');
  await page.getByPlaceholder('输入授权密钥').fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(base + '/');
  const folder = await api('/folders', 'POST', { name: '集合验收目录' });
  const document = await api('/records', 'POST', { name: '性能讨论.md', folderId: folder.id, content: '# 说明\n\n编辑器性能和内存数据。' });
  await api('/records', 'POST', { name: '索引性能.md', content: '# 索引性能' });
  await api('/records', 'POST', { name: '不相关.md', folderId: folder.id, content: '# 课程安排' });

  let parses = 0;
  await page.route('**/api/collections/parse', async route => {
    parses++;
    assert.equal(route.request().postDataJSON().description, '包含「性能」的文稿');
    await route.fulfill({ json: { draft: { target: 'document', keyword: '性能', archive: 'active', tagMatch: 'all' }, issues: [] } });
  });
  await page.getByRole('link', { name: '智能集合', exact: true }).click();
  await page.getByRole('button', { name: '新建集合', exact: true }).click();
  await page.getByRole('textbox', { name: '集合名称' }).fill('我的性能集合');
  await page.getByRole('textbox', { name: '自然语言描述' }).fill('包含「性能」的文稿');
  const generate = page.getByRole('button', { name: '生成规则' });
  const save = page.getByRole('button', { name: '保存集合' });
  await generate.click();
  await page.getByRole('region', { name: '集合预览' }).getByRole('link', { name: /性能讨论/ }).waitFor();
  await page.getByRole('region', { name: '集合预览' }).getByRole('link', { name: /索引性能/ }).waitFor();
  await page.getByRole('region', { name: '集合预览' }).getByText('全部目录', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '目录', exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('region', { name: '集合预览' }).getByRole('link', { name: /不相关/ }).count(), 0);
  const previewDone = page.waitForResponse(response => response.url().endsWith('/api/collections/preview') && response.ok());
  await generate.click();
  await previewDone;
  await page.getByRole('textbox', { name: '包含关键词' }).fill('内存');
  await page.getByRole('button', { name: '预览规则' }).click();
  await save.click();
  await page.waitForURL(/\/collections\/[\da-f-]+$/);
  await page.getByRole('heading', { name: '我的性能集合' }).waitFor();
  await page.getByRole('link', { name: /性能讨论/ }).waitFor();
  await page.reload();
  await page.getByRole('link', { name: /性能讨论/ }).waitFor();
  assert.equal(parses, 1, 'Same description, manual preview, save and open reuse the rule');

  await api('/records/' + document.id + '/meta', 'PATCH', { status: 'archived', expectedMetadataRevision: 1 });
  await page.getByRole('button', { name: '刷新结果' }).click();
  await page.getByRole('heading', { name: '没有匹配的内容' }).waitFor();
  assert.equal(parses, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '编辑集合' }).click();
  await page.getByRole('textbox', { name: '自然语言描述' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('Smart collections PASS — real persistence and live results, one reused generation, and mobile editing');
} finally {
  await browser.close();
}
