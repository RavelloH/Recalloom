import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
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

  const state = resolve(process.env.RECALLOOM_TEST_STATE ?? '');
  const localRoot = resolve('tmp');
  const distance = relative(localRoot, state);
  assert.ok(
    !isAbsolute(distance) && !distance.startsWith('..') && distance.startsWith('editor-e2e-')
  );
  function sql(command) {
    return execFileSync(
      process.execPath,
      [
        resolve('node_modules/wrangler/bin/wrangler.js'),
        'd1',
        'execute',
        'recalloom',
        '--local',
        '--persist-to',
        state,
        '--command',
        command,
        '--json'
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 }
    );
  }
  const tag = (await api('/tags', 'POST', { name: '智能力学 ' + engine })).item;
  const record = await api('/records', 'POST', {
    name: '智能标签测试 ' + engine + '.md',
    content: '这里讨论力学与运动。'
  });
  await api('/records/' + record.id + '/tags', 'POST', {
    tagId: tag.id,
    action: 'add',
    expectedMetadataRevision: 1
  });
  sql(
    `UPDATE record_tags SET source='auto',reason='Clef 相关性 93%',evidence='{}',source_revision=1,generated_at='2026-11-17T01:00:00.000Z' WHERE record_id='${record.id}'; UPDATE index_jobs SET state='done',indexed_revision=1 WHERE record_id='${record.id}'`
  );
  await api('/records', 'POST', { name: '手动标签测试.md', content: '# 手动关联', tags: [tag.name] });
  await page.goto(base + '/tags/' + tag.id);
  const manual = page.getByRole('region', { name: '手动添加' });
  const automatic = page.getByRole('region', { name: '自动推荐' });
  await manual.getByRole('link', { name: /手动标签测试/ }).waitFor();
  await automatic.getByRole('link', { name: /智能标签测试/ }).waitFor();
  assert.equal(await manual.getByRole('link', { name: /智能标签测试/ }).count(), 0);
  assert.ok(await automatic.locator('.tag-record-icon').evaluate(icon => icon.getBoundingClientRect().width >= 20));
  await page.waitForLoadState('networkidle');
  await page.goto(base + '/records/' + record.id);
  await page.getByRole('button', { name: '详细信息', exact: true }).click();
  const panel = page.locator('[data-panel-id="document-panel-info"]');
  await page
    .getByRole('button', { name: '将「' + tag.name + '」转为手动标签', exact: true })
    .waitFor();
  await page.getByText('Clef 相关性 93% · 基于 R1 向量', { exact: true }).waitFor();
  if (engine === 'chromium') {
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tmp/smart-tag-drawer.png' });
  }
  await page
    .getByRole('button', { name: '将「' + tag.name + '」转为手动标签', exact: true })
    .click();
  await page.waitForFunction(async (id) => {
    const record = await (await fetch('/api/records/' + id)).json();
    return record.tagDetails?.[0]?.source === 'manual';
  }, record.id);
  const updated = await api('/records/' + record.id);
  assert.equal(updated.revision, 1, 'accepting suggestions changes metadata only');
  // Recreate a generated recommendation in the isolated fixture to exercise dismissal/recovery.
  sql(
    `UPDATE record_tags SET source='auto',reason='Clef 相关性 93%',evidence='{}',source_revision=1 WHERE record_id='${record.id}';`
  );
  await page.reload();
  await page.getByRole('button', { name: '详细信息', exact: true }).click();
  await page.locator('.tag-auto-item button').first().waitFor();
  const remove = page
    .locator('.tag-auto-item')
    .getByRole('button', { name: /移除|删除|Remove|remove/ });
  assert.equal(await remove.count(), 1, 'automatic token has one removal control');
  await remove.click();
  await page.getByText('已忽略的标签（1）', { exact: true }).click();
  await page.getByRole('button', { name: '恢复推荐「' + tag.name + '」', exact: true }).click();
  await page.waitForFunction(async (id) => {
    const status = await (await fetch('/api/records/' + id + '/smart-tags')).json();
    return status.ignored.length === 0;
  }, record.id);
  for (const width of [390, 834, 1365]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
  }
  await page.goto(base + '/tags/manage');
  await page.getByRole('heading', { name: '标签管理' }).count();
  await noOverflow();
  mkdirSync('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/smart-tags-' + engine + '.png', fullPage: true });
  assert.deepEqual(faults, []);
  console.log(
    'Smart tags PASS ' +
      engine +
      ' — provenance, metadata-only promotion, dismissal, recovery and responsive layout'
  );
} finally {
  await browser.close();
}
