import assert from 'node:assert/strict';
import { createServer as createPortProbe } from 'node:net';
import type { Page } from 'playwright';

export async function independentPort() {
  const server = createPortProbe();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function interactions(name: string, runtime: { page: Page; url(): string }) {
  const page = runtime.page;
  const evidence: Array<{ name: string; passed: boolean; detail: string }> = [];
  const check = async (title: string, task: () => Promise<void>) => { try { await page.goto(runtime.url(), { waitUntil: 'networkidle' }); await task(); evidence.push({ name: title, passed: true, detail: 'actual browser assertions passed' }); } catch (error) { evidence.push({ name: title, passed: false, detail: String(error) }); } };
  await check('no native identity or real browser storage', async () => {
    assert.equal(await page.evaluate(() => '__TAURI_INTERNALS__' in window), false);
    const storage = await page.evaluate(() => { localStorage.setItem('rdesign-isolated-test', 'memory'); return { value: localStorage.getItem('rdesign-isolated-test'), length: localStorage.length }; });
    assert.equal(storage.value, 'memory');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => localStorage.getItem('rdesign-isolated-test')), null);
    assert.match(await page.locator('#rdesign-preview-banner').innerText(), /未授权/);
  });
  if (name === 'R-Box') {
    await check('account remains unauthorized and login disabled', async () => { await page.locator('[data-rdesign-id="box-account"]').click(); await page.locator('.account-state.unconfigured').waitFor(); assert.equal(await page.getByRole('button', { name: '使用系统浏览器登录' }).isDisabled(), true); assert.equal(await page.locator('input[type="password"]').count(), 0); });
    await check('search, details and memory favorite toggle', async () => { await page.locator('[data-rdesign-id="box-search"]').fill('R-Clip'); await page.locator('[data-rdesign-id="box-product"]').click(); const favorite = page.locator('[data-rdesign-id="box-favorite"]'); await favorite.click(); assert.equal(await favorite.getAttribute('aria-pressed'), 'true'); await favorite.click(); assert.equal(await favorite.getAttribute('aria-pressed'), 'false'); });
    await check('settings modifies memory preference and preserves focus', async () => { await page.locator('[data-rdesign-id="box-settings"]').click(); await page.locator('#theme').selectOption('dark'); assert.equal(await page.locator('#theme').inputValue(), 'dark'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement !== document.body), true); await page.locator('[data-rdesign-id="box-close"]').click(); assert.equal(await page.locator('[role="dialog"]').count(), 0); });
  }
  if (name === 'R-Vault') {
    await check('fixture entry, search, detail and lock clear the session', async () => { await page.locator('[data-rdesign-id="vault-enter"]').click(); await page.locator('.vault-card').first().waitFor(); await page.locator('[data-rdesign-id="vault-search"]').fill('开票资料'); await page.waitForFunction(() => document.querySelectorAll('.vault-card').length === 1); await page.locator('[data-rdesign-id="vault-invoice-card"]').click(); await page.locator('.detail-title h1').waitFor(); assert.match(await page.locator('.detail-title h1').innerText(), /星河/); await page.locator('[data-rdesign-id="vault-lock"]').click(); await page.locator('.welcome-form').waitFor(); assert.equal(await page.locator('.vault-card').count(), 0); });
    await check('no browser password entry or unified login authorization', async () => { assert.equal(await page.locator('input[type="password"]').count(), 0); assert.equal(await page.getByRole('button', { name: '在系统浏览器登录' }).isDisabled(), true); });
  }
  if (name === 'R-Clip') {
    await check('only synthetic history and native copy denied', async () => { await page.locator('[data-rdesign-id="clip-search"]').fill('合成笔记'); await page.waitForFunction(() => document.querySelectorAll('[data-rdesign-id="clip-item"]').length === 1); await page.locator('[data-rdesign-id="clip-item"]').click(); await page.locator('button').filter({ hasText: /复制/ }).first().click(); await page.getByText('请通过桌面应用打开，浏览器预览不会读取剪贴板。', { exact: true }).waitFor(); });
  }
  if (name === 'R-Alpha') {
    await check('original workspace navigation changes state', async () => { await page.locator('.nav-item').filter({ hasText: '研究' }).click(); assert.match(await page.locator('.workspace-container').innerText(), /策略|研究/); await page.locator('.nav-item').filter({ hasText: '实盘' }).click(); assert.match(await page.locator('.workspace-container').innerText(), /未连接|只读|未授权|未配置|安全/); });
  }
  if (name === 'ModelBase') {
    await check('search and original chat page remain offline', async () => { const search = page.locator('.search-field input'); await search.fill('Qwen'); assert.match(await page.locator('body').innerText(), /Qwen/); await page.locator('.main-nav').getByRole('button', { name: '对话', exact: true }).click(); await page.locator('.chat-workspace').waitFor(); assert.match(await page.locator('.chat-status').innerText(), /离线|未连接/); });
  }
  if (name === 'ToolBox') {
    await check('hash navigation and original logo/large PNG load', async () => { await page.locator('.ci-computer-overview__image').waitFor(); assert.equal(await page.locator('.ci-computer-overview__image').evaluate((img: any) => img.complete && img.naturalWidth > 0), true); assert.equal(await page.locator('.ci-brand__mark img').evaluate((img: any) => img.complete && img.naturalWidth > 0), true); await page.locator('.ci-sidebar a[href="#/hardware"]').click(); await page.waitForURL('**/#/hardware'); assert.match(await page.locator('body').innerText(), /演示数据|合成/); });
    await check('hardware run and report export expose explicit unavailable errors', async () => {
      await page.goto(runtime.url() + '/#/benchmarks', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '开始性能测试', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '未执行' }).waitFor();
      await page.goto(runtime.url() + '/#/reports', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '将当前会话导出为 JSON', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '未执行' }).waitFor();
      assert.equal(await page.locator('.ci-report-export .ci-report-file-name').count(), 0);
      await page.getByRole('button', { name: '打开报告文件夹', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'ToolBox openReportsDirectory' }).waitFor();
    });
  }
  if (name === 'SaveDock') {
    await check('native backup does not report successful disk write', async () => { await page.getByRole('button', { name: /创建备份/ }).first().click(); await page.locator('[role="dialog"]').waitFor(); await page.locator('[role="dialog"]').getByRole('button', { name: '创建备份', exact: true }).click(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /未执行/); });
    await check('navigate to download and recovery views', async () => { await page.getByRole('button', { name: /下载与导入/ }).first().click(); await page.getByRole('heading', { name: /下载与导入/ }).waitFor(); await page.getByRole('button', { name: /恢复事务/ }).first().click(); await page.getByRole('heading', { name: '没有未完成的恢复', exact: true }).waitFor(); });
  }
  return evidence;
}

