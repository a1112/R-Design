import { test, expect, type WebSocketRoute } from '@playwright/test';
import { BridgeClient, baseURL } from './bridge-client';
import { QUEUE_KEY } from '../../packages/annotation-core/src/index';

test('AT-08 workbench preserves ink while offline, reconnects, and recovers a lost save acknowledgement without a duplicate', async ({ page, request }) => {
  const client = await new BridgeClient(request).connect();
  await client.live();
  let offline = false;
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\?token=/, route => {
    if (offline) { route.close(); return; }
    sockets.push(route); route.connectToServer();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/editor`);
  const surface = page.getByTestId('canvas-surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await page.getByTestId('mode-annotate').click();
  await page.locator('.inspector-tabs').getByRole('button', { name: /^批注/ }).click();
  await expect(page.getByTestId('annotation-text')).toBeVisible();
  const initialChanges = (await client.state()).changes.length;

  offline = true;
  await page.context().setOffline(true);
  sockets.at(-1)!.close({ code: 1001, reason: 'E2E network disconnected' });
  await expect(page.locator('.connection')).toContainText('离线');
  await expect(page.getByTestId('mode-observe')).toHaveClass(/active/);
  await page.getByTestId('mode-annotate').click();
  const bounds = await surface.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.move(bounds!.x + bounds!.width * 0.5, bounds!.y + bounds!.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.56, bounds!.y + bounds!.height * 0.46, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('annotation-text').fill('E2E 离线笔迹：保持按钮点击行为。');
  await page.getByTestId('save-annotation').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]').length, QUEUE_KEY)).toBe(1);
  const queued = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]')[0], QUEUE_KEY);
  expect(queued.annotation.strokes[0].points.length).toBeGreaterThan(2);
  expect((await client.state()).project.annotations.some(annotation => annotation.id === queued.annotation.id)).toBeFalsy();

  offline = false;
  await page.context().setOffline(false);
  await expect(page.locator('.connection')).toContainText('Bridge 已连接', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]').length, QUEUE_KEY)).toBe(0);
  const afterOffline = await client.state();
  const saved = afterOffline.project.annotations.find(annotation => annotation.id === queued.annotation.id);
  expect(saved?.strokes).toEqual(queued.annotation.strokes);
  expect(afterOffline.changes).toHaveLength(initialChanges);

  let loseAcknowledgement = true;
  await page.route('**/api/annotations', async route => {
    if (loseAcknowledgement) {
      loseAcknowledgement = false;
      const savedResponse = await route.fetch();
      expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByTestId('annotation-text').fill('E2E 已保存，但响应丢失；重放不得重复。');
  await page.getByTestId('save-annotation').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]').length, QUEUE_KEY)).toBe(1);
  const lostAck = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]')[0], QUEUE_KEY);
  await expect.poll(async () => (await client.state()).project.annotations.filter(annotation => annotation.id === lostAck.annotation.id).length).toBe(1);
  sockets.at(-1)!.close({ code: 1001, reason: 'E2E reconnect after lost acknowledgement' });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]').length, QUEUE_KEY), { timeout: 15_000 }).toBe(0);
  expect((await client.state()).project.annotations.filter(annotation => annotation.id === lostAck.annotation.id)).toHaveLength(1);
  expect((await client.state()).changes).toHaveLength(initialChanges);
});
