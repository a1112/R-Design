import { test, expect } from '@playwright/test';
import type { RuntimeFrame, Stroke } from '../../packages/protocol/src/index';
import { BridgeClient, baseURL } from './bridge-client';

type NativeDrawing = { frameId: string; nativeData: string; strokes: Stroke[] };
interface WorkbenchNativeAPI {
  frame(): RuntimeFrame | null;
  mode(): string;
  addNativeDrawing(drawing: NativeDrawing): { accepted: boolean; frameId: string | null };
}
const nativeStroke = (frameId: string, index: number, offset = 0): Stroke => ({
  id: `pencil-${frameId}-${index}`, color: '#e58b43', width: 3,
  points: [{ x: 180 + index * 30, y: 190 + offset, pressure: 0.4, time: 0 }, { x: 205 + index * 30, y: 213 + offset, pressure: 0.8, time: 16 }],
});

test('native drawing API gates the frozen target, replaces repeated drawings, and restores complete annotation drafts', async ({ page, request }) => {
  const client = await new BridgeClient(request).connect();
  await client.live();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/editor`);
  const surface = page.getByTestId('canvas-surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __RDESIGN_WORKBENCH__?: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__))).toBeTruthy();

  const nonAnnotation = await page.evaluate(() => {
    const api = (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__;
    return api.addNativeDrawing({ frameId: api.frame()!.id, nativeData: 'ignored', strokes: [] });
  });
  expect(nonAnnotation.accepted).toBeFalsy();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]'))).toEqual([]);
  await page.getByTestId('mode-annotate').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.mode())).toBe('annotate');
  const frozen = await page.evaluate(() => (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.frame()!);
  expect(frozen.status).toBe('frozen');
  const wrongFrame: NativeDrawing = { frameId: `${frozen.id}-wrong`, nativeData: 'ignored', strokes: [nativeStroke(frozen.id, 0)] };
  expect((await page.evaluate(drawing => (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.addNativeDrawing(drawing), wrongFrame)).accepted).toBeFalsy();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]'))).toEqual([]);

  const bounds = await surface.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * 0.2, bounds!.y + bounds!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.25, bounds!.y + bounds!.height * 0.25, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]').length)).toBe(1);
  const webStroke: Stroke = await page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]')[0]);
  expect(webStroke.id).not.toMatch(/^pencil-/);

  const firstDrawing: NativeDrawing = { frameId: frozen.id, nativeData: 'bmF0aXZlLWRyYXdpbmctdjE=', strokes: [nativeStroke(frozen.id, 0), nativeStroke(frozen.id, 1)] };
  expect((await page.evaluate(drawing => (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.addNativeDrawing(drawing), firstDrawing)).accepted).toBeTruthy();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]').length)).toBe(3);
  const updatedDrawing: NativeDrawing = { frameId: frozen.id, nativeData: 'bmF0aXZlLWRyYXdpbmctdjI=', strokes: [nativeStroke(frozen.id, 0, 7), nativeStroke(frozen.id, 1, 7), nativeStroke(frozen.id, 2, 7)] };
  await page.evaluate(drawing => {
    const api = (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__;
    api.addNativeDrawing(drawing); api.addNativeDrawing(drawing);
  }, updatedDrawing);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]').length)).toBe(4);
  const draft: Stroke[] = await page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]'));
  expect(new Set(draft.map(stroke => stroke.id)).size).toBe(4);
  expect(draft.find(stroke => stroke.id === webStroke.id)).toEqual(webStroke);
  expect(draft.filter(stroke => stroke.nativeData)).toHaveLength(1);
  expect(draft.find(stroke => stroke.nativeData)?.nativeData).toBe(updatedDrawing.nativeData);
  expect(draft.find(stroke => stroke.id === updatedDrawing.strokes[0].id)?.points).toEqual(updatedDrawing.strokes[0].points);

  await page.locator('.inspector-tabs').getByRole('button', { name: /^批注/ }).click();
  const note = 'E2E 模拟原生绘图传输：草稿须保留完整冻结画面。';
  await page.getByTestId('annotation-text').fill(note);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.frame`) ?? 'null')?.id)).toBe(frozen.id);
  await page.reload();
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  const restored = await page.evaluate(() => ({
    frame: (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.frame(),
    strokes: JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`) ?? '[]'), note: localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.note`),
  }));
  expect(restored.frame?.id).toBe(frozen.id);
  expect(restored.frame?.image).toBe(frozen.image);
  expect(restored.strokes).toEqual(draft);
  expect(restored.note).toBe(note);
  await page.getByTestId('mode-annotate').click();
  await page.locator('.inspector-tabs').getByRole('button', { name: /^批注/ }).click();
  await expect(page.getByTestId('annotation-text')).toHaveValue(note);
  await expect(page.getByTestId('save-annotation')).toBeEnabled();
  await page.getByTestId('save-annotation').click();
  await expect.poll(async () => (await client.state()).project.annotations.filter(annotation => annotation.text === note).length).toBe(1);
  const state = await client.state();
  const saved = state.project.annotations.find(annotation => annotation.text === note)!;
  expect(saved.strokes).toEqual(draft);
  expect(new Set(saved.strokes.map(stroke => stroke.id)).size).toBe(4);
  expect(saved.strokes.filter(stroke => stroke.nativeData)).toHaveLength(1);
  expect(state.project.snapshots.find(frame => frame.id === saved.anchor.frameId)?.image).toBe(frozen.image);
  await expect.poll(() => page.evaluate(() => localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.frame`))).toBeNull();

  await page.getByRole('button', { name: '新建设计画板', exact: true }).click();
  const designRejected = await page.evaluate(drawing => (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchNativeAPI }).__RDESIGN_WORKBENCH__.addNativeDrawing(drawing), updatedDrawing);
  expect(designRejected.accepted).toBeFalsy();
});
