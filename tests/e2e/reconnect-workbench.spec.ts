import { test, expect, type WebSocketRoute } from '@playwright/test';
import type { Stroke, RuntimeFrame } from '../../packages/protocol/src/index';
import { BridgeClient, baseURL } from './bridge-client';

test('local workbench reauthenticates a revoked session during reconnect and retains the frozen draft', async ({ page, request }) => {
  const client = await new BridgeClient(request).connect();
  await client.live();
  const sockets: WebSocketRoute[] = [];
  let bootstrapRequests = 0;
  let expireNextState = false;
  let expiredResponses = 0;
  await page.routeWebSocket(/\/ws\?token=/, route => { sockets.push(route); route.connectToServer(); });
  await page.route('**/api/bootstrap', async route => { bootstrapRequests++; await route.continue(); });
  // Inject one expired-authorization response; all runtime frames and subsequent requests
  // continue to the actual Bridge rather than a simulated runtime.
  await page.route('**/api/state', async route => {
    if (expireNextState) {
      expireNextState = false; expiredResponses++;
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'E2E session expired during reconnect', retryable: false } }) });
    } else await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/editor`);
  const surface = page.getByTestId('canvas-surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await page.getByTestId('mode-annotate').click();
  await page.locator('.inspector-tabs').getByRole('button', { name: /^批注/ }).click();
  const bounds = await surface.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, bounds!.y + bounds!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.42, bounds!.y + bounds!.height * 0.35, { steps: 6 });
  await page.mouse.up();
  const note = 'E2E 会话失效后重新授权：保留完整冻结画面和笔迹草稿。';
  await page.getByTestId('annotation-text').fill(note);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]').length)).toBe(1);
  await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.frame`) ?? 'null')?.image))).toBeTruthy();
  const draft = await page.evaluate(() => ({
    strokes: JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]') as Stroke[],
    frame: JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.frame`) ?? 'null') as RuntimeFrame,
    note: localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.note`),
  }));
  await expect(page.getByTestId('save-annotation')).toBeEnabled();
  const baselineBootstrap = bootstrapRequests;
  const baselineConnections = sockets.length;
  expireNextState = true;
  sockets.at(-1)!.close({ code: 1012, reason: 'E2E expired session reconnect' });
  await expect(page.locator('.connection')).toContainText('离线');
  await expect(page.getByTestId('mode-observe')).toHaveClass(/active/);
  await expect.poll(() => expiredResponses).toBe(1);
  await expect.poll(() => bootstrapRequests).toBeGreaterThan(baselineBootstrap);
  await expect.poll(() => sockets.length).toBeGreaterThan(baselineConnections);
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await expect(page.getByTestId('mode-observe')).toHaveClass(/active/);
  const retained = await page.evaluate(() => ({
    strokes: JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]'),
    frame: JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.frame`) ?? 'null'),
    note: localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.note`),
  }));
  expect(retained.strokes).toEqual(draft.strokes);
  expect(retained.frame.id).toBe(draft.frame.id);
  expect(retained.frame.image).toBe(draft.frame.image);
  expect(retained.note).toBe(note);
  await expect(page.getByTestId('annotation-text')).toHaveValue(note);
  await expect(page.getByTestId('save-annotation')).toBeEnabled();
  await page.getByTestId('save-annotation').click();
  await expect.poll(async () => (await client.state()).project.annotations.filter(annotation => annotation.text === note).length).toBe(1);
  const state = await client.state();
  const saved = state.project.annotations.find(annotation => annotation.text === note)!;
  expect(saved.strokes).toEqual(draft.strokes);
  expect(state.project.snapshots.find(frame => frame.id === saved.anchor.frameId)?.image).toBe(draft.frame.image);
});
