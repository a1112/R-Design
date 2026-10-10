import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Actual original UI interactions; native commands must reject and are never accepted as successful. */
export async function verifyShareMouseNarrow(runtime: any, runRoot: string) {
  const page = runtime.page, results: any[] = [];
  const settled = () => page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  async function audit() {
    await settled();
    return page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')].filter(element => {
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const clipped = controls.filter(element => { const r = element.getBoundingClientRect(); return r.x < -0.5 || r.right > innerWidth + 0.5; }).map(element => ({ text: element.textContent?.trim(), title: element.title }));
      const root = document.querySelector<HTMLElement>('[data-rdesign-id="rshare-shell"]')!;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-rdesign-responsive="titlebar"],[data-rdesign-responsive="layout-toolbar"],[data-rdesign-responsive="settings-navigation"],[data-rdesign-responsive="settings-content"]')];
      const overflow = [document.documentElement, document.body, root, ...rows].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ tag: element.tagName, role: element.dataset.rdesignResponsive, width: element.clientWidth, scrollWidth: element.scrollWidth }));
      return { viewport: { width: innerWidth, height: innerHeight }, visibleControls: controls.length, clipped, horizontalOverflow: overflow };
    });
  }
  async function reachable(locator: any) {
    await locator.scrollIntoViewIfNeeded();
    const result = await locator.evaluate((element: HTMLElement) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const ancestors = []; let parent = element.parentElement;
      while (parent) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX) && (r.x < bounds.x - 1 || r.right > bounds.right + 1)) ancestors.push('horizontal');
        if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY) && (r.y < bounds.y - 1 || r.bottom > bounds.bottom + 1)) ancestors.push('vertical');
        parent = parent.parentElement;
      }
      return { visible: r.width > 0 && r.height > 0 && r.x >= -0.5 && r.y >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, hit: Boolean(hit && (hit === element || element.contains(hit))), clippedAncestors: ancestors };
    });
    assert(result.visible && result.hit && result.clippedAncestors.length === 0, JSON.stringify(result));
    await locator.click({ trial: true }); await locator.focus();
    assert(await locator.evaluate((element: HTMLElement) => document.activeElement === element));
    return result;
  }
  async function canvasView() {
    await page.waitForFunction(() => !document.querySelector('[data-rdesign-responsive="layout-sidebar"]')?.getAnimations().some(animation => animation.playState === 'running'), undefined, { timeout: 5000 });
    await settled();
    return page.locator('[data-rdesign-responsive="layout-transform"]').evaluate((element: HTMLElement) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { zoom: matrix.a, panOffset: { x: matrix.e / matrix.a, y: matrix.f / matrix.a }, documentTimeOrigin: performance.timeOrigin, url: location.href };
    });
  }
  function sameView(actual: any, expected: any) {
    for (const [a, b] of [[actual.zoom, expected.zoom], [actual.panOffset.x, expected.panOffset.x], [actual.panOffset.y, expected.panOffset.y]]) assert(Math.abs(a - b) < 0.002, JSON.stringify({ actual, expected }));
    assert.equal(actual.documentTimeOrigin, expected.documentTimeOrigin, 'Viewport round trip must use the same document');
    assert.equal(actual.url, expected.url);
  }
  async function panCanvas() {
    const rect = await page.locator('[data-rdesign-responsive="layout-canvas"]').boundingBox(); assert(rect);
    const x = rect.x + rect.width - 80, y = rect.y + rect.height - 60;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 30, y - 20, { steps: 6 }); await page.mouse.up();
    await settled();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(runtime.url() + '/#layout', { waitUntil: 'networkidle' });
    await page.locator('[data-rdesign-page="layout"]').waitFor();
    const initial = await audit(); assert.deepEqual(initial.clipped, []); assert.deepEqual(initial.horizontalOverflow, []);
    const seven = [];
    seven.push({ control: '启动服务', ...await reachable(page.getByRole('button', { name: '启动服务', exact: true })) });
    for (const title of ['最小化', '最大化', '关闭', '上移', '下移', '右移']) seven.push({ control: title, ...await reachable(page.getByTitle(title, { exact: true })) });
    for (const id of ['layout', 'devices', 'logs', 'settings']) await reachable(page.locator(`[data-rdesign-id="rshare-nav-${id}"]`));
    await reachable(page.getByTitle('左移', { exact: true }));
    await page.getByTitle('隐藏侧栏', { exact: true }).click();
    assert.equal(await page.locator('[data-rdesign-responsive="layout-sidebar"]').isVisible(), false);
    await page.getByTitle('显示侧栏', { exact: true }).click();
    assert(await page.locator('[data-rdesign-responsive="layout-sidebar"]').isVisible());
    await settled();
    const percent = () => page.locator('[data-rdesign-responsive="layout-zoom"] span').textContent();
    const beforeZoom = await percent(); await page.getByTitle('缩小画布', { exact: true }).click(); assert.notEqual(await percent(), beforeZoom);
    await page.getByTitle('重置画布', { exact: true }).click(); assert.equal(await percent(), beforeZoom);
    for (const title of ['上移', '下移', '左移', '右移']) await reachable(page.getByTitle(title, { exact: true }));
    await page.locator('[data-rdesign-id="rshare-nav-layout"]').focus(); await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('data-rdesign-id') === 'rshare-nav-devices'));
    for (const title of ['最小化', '最大化', '关闭']) {
      await page.getByTitle(title, { exact: true }).click();
      await page.locator('[data-rdesign-responsive="error-notice"]').filter({ hasText: '纯设计预览' }).waitFor();
    }
    await page.getByRole('button', { name: '启动服务', exact: true }).click();
    await page.locator('[data-rdesign-responsive="error-notice"]').filter({ hasText: '纯设计预览' }).waitFor();
    const native = await page.evaluate(() => ({ installed: '__TAURI_INTERNALS__' in window || '__TAURI__' in window, blocked: (window as any).__RDESIGN_DESIGN_PREVIEW__.diagnostics.blocked }));
    assert.equal(native.installed, false); assert(native.blocked.some((value: string) => value.includes('/__rshare/service')));
    const layout = await audit(); assert.deepEqual(layout.clipped, []); assert.deepEqual(layout.horizontalOverflow, []);
    await page.screenshot({ path: path.join(runRoot, `narrow-layout-controls-${width}.png`) });
    await page.locator('[data-rdesign-id="rshare-nav-settings"]').click();
    assert.equal(new URL(page.url()).hash, '#settings');
    const sectionIds = ['local', 'service', 'mobile', 'hardware', 'input', 'appearance', 'acceptance'];
    for (const id of sectionIds) await reachable(page.locator(`[data-rdesign-id="rshare-settings-${id}"]`));
    await page.locator('[data-rdesign-id="rshare-settings-appearance"]').click();
    const appearance = page.locator('[data-rdesign-id="rshare-theme-light"]'); await appearance.waitFor();
    for (const mode of ['dark', 'light', 'system']) {
      const button = page.locator(`[data-rdesign-id="rshare-theme-${mode}"]`); await reachable(button); await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    await appearance.click();
    const settings = await audit(); assert.deepEqual(settings.clipped, []); assert.deepEqual(settings.horizontalOverflow, []);
    await page.screenshot({ path: path.join(runRoot, `narrow-settings-controls-${width}.png`) });
    results.push({ width, height: 844, passed: true, originalSevenControls: seven, layout, settings, keyboardNavigation: 'passed actual Tab focus', sidebarToggle: 'passed original local state', zoomAndFitReset: 'passed original zoom/pan readback', settingsNavigation: 'all seven original sections reachable via their vertical scroll container', themeSelection: 'passed actual aria-pressed readback for dark/light/system', nativeWindowAndService: 'explicitly unavailable; no native success accepted' });
  }
  const roundTrips: any[] = [];
  for (const desktopMode of ['default', 'manual']) {
    // Load once to establish each desktop case. Every subsequent viewport change uses this document.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.url() + '/#layout', { waitUntil: 'networkidle' });
    await page.locator('[data-rdesign-responsive="layout-transform"]').waitFor();
    const initial = await canvasView(); assert.equal(initial.zoom, 1); assert.deepEqual(initial.panOffset, { x: 0, y: 0 });
    if (desktopMode === 'manual') {
      await page.getByTitle('缩小画布', { exact: true }).click();
      const zoomed = await canvasView(); assert.notEqual(zoomed.zoom, initial.zoom);
      await panCanvas(); const panned = await canvasView();
      assert(Math.abs(panned.panOffset.x - zoomed.panOffset.x) > 1 && Math.abs(panned.panOffset.y - zoomed.panOffset.y) > 1, 'Actual desktop drag must change both pan axes');
    }
    const desktop = await canvasView();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const fitted = await canvasView(); assert(fitted.zoom > 0 && fitted.zoom <= 1, JSON.stringify(fitted)); assert.equal(fitted.documentTimeOrigin, desktop.documentTimeOrigin);
      assert(Math.abs(fitted.zoom - desktop.zoom) > 0.002 || Math.abs(fitted.panOffset.x - desktop.panOffset.x) > 0.002 || Math.abs(fitted.panOffset.y - desktop.panOffset.y) > 0.002, 'Narrow geometry must apply a fitted view');
      const fitAudit = await audit(); assert.deepEqual(fitAudit.clipped, []); assert.deepEqual(fitAudit.horizontalOverflow, []);
      await page.setViewportSize({ width: 1440, height: 900 });
      const restored = await canvasView(); sameView(restored, desktop);
      await page.setViewportSize({ width, height: 844 });
      await page.getByTitle('缩小画布', { exact: true }).click(); await panCanvas();
      const manualNarrow = await canvasView(); assert.notEqual(manualNarrow.zoom, fitted.zoom);
      const otherWidth = width === 390 ? 320 : 390;
      await page.setViewportSize({ width: otherWidth, height: 844 }); sameView(await canvasView(), manualNarrow);
      await page.setViewportSize({ width: 1440, height: 900 }); sameView(await canvasView(), desktop);
      await page.setViewportSize({ width, height: 844 });
      const manualNarrowRestored = await canvasView(); sameView(manualNarrowRestored, manualNarrow);
      await page.getByTitle('重置画布', { exact: true }).click();
      const resetFit = await canvasView(); sameView(resetFit, fitted);
      await page.setViewportSize({ width: 1440, height: 900 });
      const finalDesktop = await canvasView(); sameView(finalDesktop, desktop);
      roundTrips.push({ desktopMode, width, passed: true, desktop, fitted, fitAudit, restored, manualNarrow, manualNarrowRestored, resetFit, finalDesktop, sameDocument: true, actualZoomButtonAndCanvasDrag: true });
    }
    await page.screenshot({ path: path.join(runRoot, `desktop-roundtrip-${desktopMode}.png`) });
  }
  await writeFile(path.join(runRoot, 'viewport-roundtrips.json'), JSON.stringify(roundTrips, null, 2) + '\n');
  return { passed: true, viewportChecks: results, samePageRoundTrips: roundTrips, desktopBehavior: 'Actual 1440 → 390/320 → 1440 round trips restore default and user-chosen desktop zoom/pan; user-chosen narrow views persist until explicit reset', horizontalOverflowAccepted: false, nativeOrBackendAccepted: false };
}
