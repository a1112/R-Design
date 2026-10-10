import { test, expect } from '@playwright/test';
import type { RuntimeFrame } from '../../packages/protocol/src/index';
import { BridgeClient, FrameObserver, baseURL, runtimeVersion } from './bridge-client';

async function inputFromCurrentFrame(client:BridgeClient,input:(frame:RuntimeFrame)=>Record<string,unknown>){
  for(let attempt=0;attempt<5;attempt++){
    const state=await client.state();const frame=state.frame!;
    const response=await client.request.post(`${baseURL}/api/input`,{headers:client.headers,data:{projectId:state.project.id,expectedRevision:state.project.revision,operationId:crypto.randomUUID(),version:runtimeVersion(frame),...input(frame)}});
    if(response.ok())return response;
    const error=await response.json();expect(error.error.code).toBe('STALE_RUNTIME');
    // Exact runtime validation occurs before dispatch; reselect from the next real
    // frame only for this no-side-effect rejection, never repeat delivered input.
    await expect.poll(async()=>(await client.state()).frame?.id).not.toBe(frame.id);
  }
  throw new Error('Runtime remained stale after five fresh-frame selections');
}

test('AT-01/02 two clients follow one real surface and live telemetry does not create tasks', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const initial = await client.live();
  const pairingResponse = await client.post('/pairing/code', await client.envelope());
  const { code } = await pairingResponse.json();
  const deviceResponse = await request.post(`${baseURL}/api/pairing/redeem`, { data: { code, name: 'E2E second observer' } });
  expect(deviceResponse.ok()).toBeTruthy();
  const { token: deviceToken, deviceId } = await deviceResponse.json();
  const secondClient = new BridgeClient(request); secondClient.token = deviceToken;
  const secondFrame = (await secondClient.live()).frame;
  expect(secondFrame.runtimeSessionId).toBe(initial.frame.runtimeSessionId);
  expect(secondFrame.surfaceId).toBe(initial.frame.surfaceId);
  expect(secondFrame.epoch).toBe(initial.frame.epoch);
  const observers = await Promise.all([FrameObserver.connect(client.token), FrameObserver.connect(deviceToken)]);
  try {
    await expect.poll(() => observers.every(observer => observer.frames.length > 0)).toBeTruthy();
    for (const observer of observers) {
      expect(observer.frames.at(-1)!.runtimeSessionId).toBe(initial.frame.runtimeSessionId);
      expect(observer.frames.at(-1)!.surfaceId).toBe(initial.frame.surfaceId);
      expect(observer.frames.at(-1)!.epoch).toBe(initial.frame.epoch);
    }
    const beforeImage = initial.frame.image;
    await expect.poll(async () => (await client.live()).frame.image, { timeout: 15_000 }).not.toBe(beforeImage);
    expect((await client.state()).changes).toHaveLength(initial.changes.length);
    await client.post('/mode', { ...(await client.envelope()), mode: 'interact' });
    const { frame } = await client.live();
    const settings = frame.nodes.find(node => node.sourceNodeId === 'settings-button' || node.runtimeNodeId === 'settings-button');
    expect(settings).toBeTruthy();
    await inputFromCurrentFrame(client,current=>{const target=current.nodes.find(node=>node.sourceNodeId==='settings-button'||node.runtimeNodeId==='settings-button')!;return {action:'click',x:target.bounds.x+target.bounds.w/2,y:target.bounds.y+target.bounds.h/2};});
    await expect.poll(() => observers.every(observer => observer.frames.some(frame => frame.nodes.some(node => node.role === 'dialog' || node.tag === 'dialog')))).toBeTruthy();
    const modal = (await client.live()).frame;
    expect(modal.nodes.some(node => node.role === 'dialog' || node.tag === 'dialog')).toBeTruthy();
    expect(modal.runtimeSessionId).toBe(initial.frame.runtimeSessionId);
    expect(modal.image).not.toBe(beforeImage);
    const structure = JSON.stringify(modal.nodes);
    expect(structure).not.toContain('fixture-private-token');
    expect(structure).not.toContain('private-fixture-secret');
    expect(modal.nodes.find(node => node.sourceNodeId === 'settings-password')?.text).not.toContain('secret');
    await inputFromCurrentFrame(client,()=>({action:'key',key:'Escape'}));
    await client.post('/mode', { ...(await client.envelope()), mode: 'observe' });
  } finally {
    observers.forEach(observer => observer.close());
    // A failed assertion must not leave a modal covering the next acceptance scenario.
    await client.post('/scenarios/overview-desktop/capture', await client.envelope()).catch(() => undefined);
    await client.post('/mode', { ...(await client.envelope()), mode: 'observe' }).catch(() => undefined);
    await client.post(`/devices/${deviceId}/revoke`, await client.envelope()).catch(() => undefined);
  }
});

test('workbench uses a real captured image and remains usable at a narrow viewport', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseURL}/editor`);
  const surface = page.getByTestId('canvas-surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => surface.locator('img').count()).toBeGreaterThan(0);
  await expect(surface.locator('img').first()).toHaveAttribute('src', /^(data:image\/(png|jpeg)|\/)/);
  expect(await surface.locator('iframe').count(), 'A duplicate iframe would not follow the controlled source state').toBe(0);
  await expect(page.getByTestId('mode-annotate')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(surface).toBeVisible();
  await expect(page.getByTestId('mode-annotate')).toBeVisible();
  await page.getByTestId('canvas-fit').click();
  await expect.poll(async () => {
    const image = await surface.boundingBox();
    const viewport = await page.getByTestId('infinite-viewport').boundingBox();
    return image && viewport ? Math.max(viewport.x - image.x, image.x + image.width - viewport.x - viewport.width) : Infinity;
  }).toBeLessThanOrEqual(1);
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, 'Narrow workbench must not require scrolling the entire page sideways').toBeLessThanOrEqual(size.viewport + 1);
  await page.screenshot({ path: 'test-results/workbench-narrow.png', fullPage: true });
  expect(pageErrors, 'Desktop and narrow workbench must not produce uncaught JavaScript errors').toEqual([]);
});


test('mapped property understanding, candidate verification, acceptance and revert work through the UI', async ({ page, request }) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/editor`);
  await expect(page.getByTestId('canvas-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await page.locator('.sidebar-tabs').getByRole('button', { name: '图层', exact: true }).click();
  await page.getByTestId('node-start-button').click();
  await expect(page.getByTestId('property-text')).toBeEnabled();
  await page.getByTestId('property-text').fill('UI 验收：立即开始');
  await page.getByTestId('property-borderRadius').fill('18');
  await page.getByTestId('prepare-change').click();
  await expect(page.getByTestId('confirm-change')).toBeVisible();
  expect((await client.state()).changes).toHaveLength(before.changes.length);
  for(let attempt=0;attempt<4;attempt++){
    const preparation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/changes/prepare'&&response.request().method()==='POST');
    await page.getByTestId('confirm-change').click();
    const response=await preparation;
    if(response.ok())break;
    const error=await response.json();expect(error.error.code).toBe('STALE_RUNTIME');
    // The fixture updates telemetry; an exact-version rejection requires a fresh
    // displayed frame and explicit reselection before repeating the same intent.
    const failedFrame=await page.evaluate(()=>(window as unknown as {__RDESIGN_WORKBENCH__:{frame():{id:string}|null}}).__RDESIGN_WORKBENCH__.frame()?.id);
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {__RDESIGN_WORKBENCH__:{frame():{id:string}|null}}).__RDESIGN_WORKBENCH__.frame()?.id)).not.toBe(failedFrame);
    await page.getByTestId('node-start-button').click();
  }
  await expect.poll(async () => (await client.state()).changes.length).toBe(before.changes.length + 1);
  await expect(page.getByTestId('verify-change')).toBeEnabled();
  await expect(page.getByTestId('accept-change')).toBeDisabled();
  await page.getByTestId('verify-change').click();
  await expect(page.getByTestId('accept-change')).toBeEnabled({ timeout: 60_000 });
  const candidate = (await client.state()).changes.at(-1)!;
  expect(candidate.candidateFrame?.nodes.find(node => node.sourceNodeId === 'start-button')?.text).toBe('UI 验收：立即开始');
  await page.getByTestId('accept-change').click();
  await expect.poll(async () => (await client.live()).frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text, { timeout: 30_000 }).toBe('UI 验收：立即开始');
  await expect(page.getByTestId('revert-change')).toBeEnabled();
  await page.getByTestId('revert-change').click();
  await expect.poll(async () => (await client.live()).frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text, { timeout: 30_000 }).toBe('开始监控');
  expect((await client.state()).changes.find(change => change.id === candidate.id)?.status).toBe('reverted');
});
