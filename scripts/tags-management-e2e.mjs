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
page.on('crash', () => console.log('Tag page renderer crashed'));
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
  async function frame() {
    return page.locator('.page').evaluate((element) => {
      const style = getComputedStyle(element),
        bounds = element.getBoundingClientRect();
      return { top: style.paddingTop, width: bounds.width, left: bounds.left };
    });
  }
  await page.getByRole('heading', { name: '概览', exact: true }).waitFor();
  const homeFrame = await frame();
  const ordinaryRoutes = [
    ['/archive', '归档'],
    ['/activity', '活动'],
    ['/search', '搜索'],
    ['/settings', '设置'],
    ['/help', 'RMD 语法帮助'],
    ['/tags', '标签']
  ];
  for (const [path, title] of ordinaryRoutes) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const actual = await frame();
    assert.equal(actual.top, homeFrame.top, path + ' shares home top spacing');
    assert.ok(Math.abs(actual.width - homeFrame.width) < 2, path + ' shares home width');
    assert.ok(Math.abs(actual.left - homeFrame.left) < 2, path + ' shares home alignment');
  }
  for (const [path, title] of [
    ['/tasks', '任务'],
    ['/graph', '知识关系网']
  ]) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const actual = await frame();
    assert.ok(actual.width > homeFrame.width + 100, path + ' retains full width');
    assert.equal(actual.top, '28px');
  }
  const docHeader = await api('/records', 'POST', { name: 'Header document.md' });
  const taskHeader = await api('/records', 'POST', { name: 'Header task list', kind: 'task_list' });
  const recordRoutes = [
    ['/library', '知识库'],
    ['/records/' + docHeader.id, 'Header document'],
    ['/records/' + taskHeader.id, 'Header task list']
  ];
  for (const [path, title] of recordRoutes) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const actual = await frame();
    assert.equal(actual.top, homeFrame.top, path + ' shares home top spacing');
    assert.ok(Math.abs(actual.width - homeFrame.width) < 2, path + ' shares home width');
  }
  await page.goto(base + '/tags');
  await page.getByRole('heading', { name: '标签', exact: true }).waitFor();
  assert.match(
    await page.getByRole('combobox', { name: '标签排序', exact: true }).innerText(),
    /使用最多/
  );
  const tagNames = Array.from(
    { length: 84 },
    (_, index) => 'dense-tag-' + String(index).padStart(2, '0')
  );
  for (const name of tagNames) await api('/tags', 'POST', { name });
  await api('/records', 'POST', { name: 'Usage order.md', tags: ['dense-tag-83'] });
  await page.reload();
  await page.locator('.tag-cloud-token').filter({ hasText: 'dense-tag-83' }).waitFor();
  assert.equal(await page.locator('.tag-cloud-token').count(), 85);
  assert.match(await page.locator('.tag-cloud-token').first().innerText(), /dense-tag-83/);
  const geometry = await page
    .locator('.tags-page')
    .evaluate((element) => ({ width: element.getBoundingClientRect().width }));
  assert.ok(Math.abs(geometry.width - homeFrame.width) < 2);
  const positions = await page
    .locator('.tag-cloud-token')
    .evaluateAll((elements) =>
      elements.slice(0, 12).map((element) => element.getBoundingClientRect().top)
    );
  assert.ok(new Set(positions).size < positions.length / 2, 'several tags fit on each row');
  mkdirSync('tmp/tags', { recursive: true });
  // Windows WebKit can crash when a screenshot precedes viewport resizing.
  // Both engines still verify density, constrained width and mobile overflow.
  if (engine === 'chromium')
    await page.screenshot({ path: 'tmp/tags/' + engine + '-dense-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  if (engine === 'chromium')
    await page.screenshot({ path: 'tmp/tags/' + engine + '-dense-mobile.png' });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: '新建标签', exact: true }).click();
  await waitForPanel();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('Research');
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('Research library');
  await page.getByRole('textbox', { name: '添加别名', exact: true }).fill('研究');
  await page.getByRole('button', { name: '添加别名', exact: true }).click();
  await page.getByRole('button', { name: '创建标签', exact: true }).click();
  await page.locator('.tag-cloud-token').filter({ hasText: 'Research' }).waitFor();
  const source = (await api('/tags?query=Research')).items[0];
  const target = (await api('/tags', 'POST', { name: 'Knowledge', color: 'green', description: 'Shared knowledge' })).item;
  const record = await api('/records', 'POST', {
    name: 'Tag test.md',
    content: '# Tag test',
    tags: ['研究', 'Knowledge']
  });
  assert.equal((await api('/records/' + record.id)).tags.length, 2);
  await page.goto(base + '/tags/' + source.id);
  await page.locator('.tag-record-row').filter({ hasText: 'Tag test.md' }).waitFor();
  assert.match(await page.getByRole('button', { name: /^标签组合/ }).innerText(), /1 个标签/);
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
  const related = await api('/records', 'POST', { name: 'Related note.md', content: '# Related note', tags: ['Knowledge'] });
  await noOverflow();
  await page.waitForLoadState('networkidle');
  await page.goto(base + '/records/' + record.id);
  const token = page.locator('.workbench-summary-tag').filter({ hasText: 'Knowledge' });
  const preview = page.locator('.tag-preview');
  const tokenColors = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });
  await token.getByRole('button', { name: 'Knowledge' }).press('Enter');
  await preview.getByText('Shared knowledge').waitFor();
  await preview.getByText('当前文稿').waitFor();
  await preview.getByRole('link', { name: /Related note\.md/ }).waitFor();
  assert.equal(page.url(), base + '/records/' + record.id);
  assert.deepEqual(await tokenColors(token), await tokenColors(preview.locator('.tag-token-list [data-color="green"]')));
  await page.locator('[data-workspace-panel="document-panel-tag"]').getByRole('button', { name: '关闭', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  await token.click();
  await preview.getByRole('link', { name: '打开标签页' }).click();
  await page.waitForURL(base + '/tags/' + target.id);
  const untagged = await api('/records', 'POST', {
    name: 'Picker test.md',
    content: '# Picker body'
  });
  await page.waitForLoadState('networkidle');
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
  await page.goto(base + '/');
  await page.getByRole('heading', { name: '概览', exact: true }).waitFor();
  const mobileHome = await frame();
  for (const [path, title] of [...ordinaryRoutes, ...recordRoutes]) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const actual = await frame();
    assert.equal(actual.top, mobileHome.top, path + ' shares mobile home top spacing');
    assert.ok(Math.abs(actual.width - mobileHome.width) < 2, path + ' shares mobile home width');
    await noOverflow();
  }
  await page.goto(base + '/records/' + record.id);
  await token.click();
  await page.getByRole('dialog', { name: '标签详情' }).waitFor();
  await preview.getByRole('link', { name: /Related note\.md/ }).click();
  await page.waitForURL(base + '/records/' + related.id);
  await preview.waitFor({ state: 'hidden' });
  await noOverflow();
  await page.goto(base + '/tags/manage');
  await page.getByRole('textbox', { name: '搜索标签', exact: true }).fill('Knowledge');
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
