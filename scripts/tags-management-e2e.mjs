import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright-core';
import { readLocalAuthVars } from './local-auth-config.mjs';

const base = process.env.RECALLOOM_TEST_BASE;
assert.match(base ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, 'Use the disposable local Worker/D1');
const engine = process.env.RECALLOOM_E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const line = readLocalAuthVars()
  .split(/\r?\n/)
  .find((line) => /^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret = line
  ?.slice(line.indexOf('=') + 1)
  .trim()
  .replace(/^["']|["']$/g, '');
assert.ok(secret);
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engine === 'chromium' ? { executablePath } : {})
});
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, colorScheme: 'dark' });
const faults = [];
page.on('pageerror', (error) => faults.push(error.message));
if (engine === 'webkit') {
  let session = '';
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const response = await route.fetch(
      session ? { headers: { ...(await request.allHeaders()), cookie: session } } : undefined
    );
    if (new URL(request.url()).pathname === '/api/auth/login')
      session =
        /^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie'] ?? '')?.[1] ?? '';
    await route.fulfill({ response });
  });
}
async function api(path, method = 'GET', body) {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api' + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, data: await response.json() };
    },
    { path, method, body }
  );
  assert.ok(result.status < 300, JSON.stringify(result));
  return result.data;
}
async function waitForPanel() {
  await page.locator('.tag-form').waitFor({ state: 'visible' });
}
async function noOverflow() {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
try {
  await page.goto(base + '/login');
  await page.getByPlaceholder('输入授权密钥').fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(base + '/');
  await page.goto(base + '/tags');
  await page.getByRole('heading', { name: '标签', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建标签', exact: true }).click();
  await waitForPanel();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('Research');
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('Research library');
  await page.getByRole('textbox', { name: '添加别名', exact: true }).fill('研究');
  await page.getByRole('button', { name: '添加别名', exact: true }).click();
  await page.getByRole('button', { name: '创建标签', exact: true }).click();
  await page.locator('.tag-catalog-name').filter({ hasText: 'Research' }).waitFor();
  const source = (await api('/tags?query=Research')).items[0];
  const target = (await api('/tags', 'POST', { name: 'Knowledge', color: 'green' })).item;
  const record = await api('/records', 'POST', {
    name: 'Tag test.md',
    content: '# Tag test',
    tags: ['研究', 'Knowledge']
  });
  assert.equal((await api('/records/' + record.id)).tags.length, 2);
  await page.goto(base + '/tags/' + source.id);
  await page.locator('.tag-record-row').filter({ hasText: 'Tag test.md' }).waitFor();
  await page.getByRole('button', { name: '管理标签', exact: true }).click();
  await waitForPanel();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('Research notes');
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await page.getByRole('heading', { name: 'Research notes', exact: true }).waitFor();
  await page.locator('.tag-form').waitFor({ state: 'hidden' });
  const renamed = (await api('/tags/' + source.id)).item;
  assert.ok(renamed.aliases.includes('Research'));
  await page.getByRole('button', { name: '管理标签', exact: true }).click();
  await waitForPanel();
  await page.getByRole('button', { name: /^合并到/ }).click();
  await page.getByRole('option', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: '预览合并', exact: true }).click();
  await page.locator('.tag-impact').filter({ hasText: '重叠 1 项关联' }).waitFor();
  await page.locator('.tag-impact').getByRole('button', { name: '合并标签', exact: true }).click();
  await page.getByRole('button', { name: '确认合并', exact: true }).click();
  await page.getByRole('heading', { name: 'Knowledge', exact: true }).waitFor();
  assert.equal((await api('/tags/' + source.id)).item.id, target.id);
  assert.equal((await api('/records/' + record.id)).tags.length, 1);
  await noOverflow();
  await page.goto(base + '/records/' + record.id);
  await page.locator('.workbench-summary-tag').filter({ hasText: 'Knowledge' }).waitFor();
  await page.locator('.workbench-summary-tag').filter({ hasText: 'Knowledge' }).click();
  await page.waitForURL(base + '/tags/' + target.id);
  const untagged = await api('/records', 'POST', {
    name: 'Picker test.md',
    content: '# Picker body'
  });
  await page.goto(base + '/records/' + untagged.id);
  await page.getByRole('button', { name: '信息', exact: true }).click();
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByRole('textbox', { name: '查找或创建标签', exact: true }).fill('Knowledg');
  await page
    .locator('.tag-suggestion')
    .filter({ hasText: 'Knowledge' })
    .getByRole('button', { name: '作为别名', exact: true })
    .click();
  await page.locator('.workbench-summary-tag').filter({ hasText: 'Knowledge' }).waitFor();
  assert.ok((await api('/tags/' + target.id)).item.aliases.includes('Knowledg'));
  assert.equal((await api('/records/' + untagged.id)).revision, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/tags/manage');
  await page.locator('.tag-catalog-row').filter({ hasText: 'Knowledge' }).waitFor();
  await noOverflow();
  await page.getByRole('button', { name: '管理 Knowledge', exact: true }).click();
  await waitForPanel();
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('Mobile description');
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await page.locator('.tag-catalog-name').filter({ hasText: 'Mobile description' }).waitFor();
  await page.locator('.tag-form').waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  await noOverflow();
  mkdirSync('tmp/tags', { recursive: true });
  await page.screenshot({ path: 'tmp/tags/' + engine + '-mobile.png', fullPage: true });
  assert.deepEqual(faults, []);
  console.log(
    'Tag index, aliases, rename, merge, stable links and mobile sheet passed in ' + engine
  );
} finally {
  await browser.close();
}
