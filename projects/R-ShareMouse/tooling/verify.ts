import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserRuntime } from '../../../apps/bridge/src/runtime.js';
import { fileBoundary } from '../../../apps/bridge/src/vite-security.js';
import { rdesignSourceIds } from '../../../packages/runtime-web/src/vite.js';
import { codeHash, indexSources, transform } from '../../../packages/source-binding/src/index.js';
import { repoRoot, prepare } from './prepare.mjs';
import { compileStyles } from './compile-styles.mjs';
import { dependencyRoot, dependencyAliases } from './dependencies.mjs';
import { frozenRoot, frozenSha, hostModule } from './frozen-host.mjs';
import { PreviewRuntime as FrozenPreviewRuntime } from './preview-runtime.mjs';

class PreviewRuntime extends BrowserRuntime {
  config() {
    const config = super.config();
    const allow = [this.root, path.join(repoRoot, 'packages/runtime-web'), path.join(repoRoot, 'packages/protocol'), path.join(repoRoot, 'node_modules'), dependencyRoot];
    const aliases = Object.fromEntries(Object.entries(dependencyAliases[name] ?? {}).map(([requested, installed]) => [requested, path.join(dependencyRoot, installed)]));
    return { ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, ...aliases } }, optimizeDeps: { exclude: ['pdfjs-dist', 'pdfjs-dist-v5'] }, plugins: [fileBoundary({ root: this.root, allow, privateRoots: [] }), ...config.plugins.slice(1)], server: { ...config.server, fs: { ...config.server.fs, allow } }, worker: { format: 'es' as const }, build: { minify: false } };
  }
}

const name = process.argv[2] ?? 'R-ShareMouse';
const { output, config, provenance, dependencies } = await prepare(name);
await symlink(dependencyRoot, path.join(output, 'node_modules'), 'dir');
const styles = await compileStyles(output, config);
const destination = path.join(repoRoot, '.rdesign/desktop-evidence', name);
await mkdir(destination, { recursive: true });
const runtime = new FrozenPreviewRuntime(name, output);
const errors: string[] = [];
const results: any = { name, source: config.source, styles, toolBaseline: frozenSha, runtimeMode: 'isolated compatibility rehearsal using the frozen runtime with explicit project dependency overrides; not official import acceptance', scenarios: [], interactions: [], nativeCapabilities: 'unavailable; no native operations accepted', import: 'blocked by frozen host dependency policy' };
results.installedDependencies = Object.fromEntries(await Promise.all(Object.keys(dependencies).filter(key => !key.startsWith('@rdesign/')).map(async key => {
  const dependencyPath = ['react', 'react-dom', '@tauri-apps/api'].includes(key) ? path.join(frozenRoot, 'node_modules', key) : path.join(dependencyRoot, dependencyAliases[name]?.[key] ?? key);
  return [key, JSON.parse(await readFile(path.join(dependencyPath, 'package.json'), 'utf8')).version];
})));
try {
  if (process.env.RDESIGN_PREFLIGHT_BUILD === 'true') { await runtime.build(); results.productionBuild = 'passed'; }
  await runtime.start();
  runtime.page.on('pageerror', error => errors.push(error.message));
  await runtime.page.waitForSelector(config.scenarios[0].readySelector, { timeout: 15000 });
  assert.equal(await runtime.page.locator('#root').evaluate(el => el.childElementCount > 0), true, 'The original application must mount');
  assert.equal(await runtime.page.locator('[data-rdesign-boot-error]').count(), 0, 'The source application import must succeed');
  for (const scenario of config.scenarios) {
    await runtime.page.setViewportSize(scenario.viewport);
    await runtime.page.goto(runtime.url() + scenario.route, { waitUntil: 'networkidle' });
    for (const step of scenario.steps) {
      const target = runtime.page.locator(`[data-rdesign-id="${step.target}"]`);
      if (step.action === 'click') await target.click();
      else await target.fill(step.value ?? '');
    }
    await runtime.page.waitForSelector(scenario.readySelector, { timeout: 15000 });
    await runtime.page.waitForTimeout(150);
    const frame = await runtime.capture('snapshot');
    await writeFile(path.join(destination, `${scenario.id}.png`), Buffer.from(frame.image.split(',')[1], 'base64'));
    await writeFile(path.join(destination, `${scenario.id}.frame.json`), JSON.stringify(frame));
    const mapped = frame.nodes.filter(node => node.binding?.reliability === 'exact' && node.binding.file !== 'src/main.tsx');
    assert(mapped.length > 10, `Original UI must have source mappings, got ${mapped.length}`);
    results.scenarios.push({ id: scenario.id, passed: true, viewport: scenario.viewport, nodes: frame.nodes.length, exactSourceNodes: mapped.length, clippedControls: await runtime.page.evaluate(() => [...document.querySelectorAll('button,input,select')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.x < 0 || rect.right > innerWidth); }).length), snapshot: `${scenario.id}.png` });
  }
  await runtime.page.setViewportSize({ width: 1440, height: 900 });
  await runtime.page.goto(runtime.url() + config.scenarios[0].route, { waitUntil: 'networkidle' });
  if (name === 'R-ShareMouse') {
    await runtime.page.getByRole('button', { name: '设置', exact: true }).click();
    await runtime.page.getByText('界面风格', { exact: true }).waitFor();
    assert.equal(new URL(runtime.page.url()).hash, '#settings');
    results.interactions.push({ name: 'Layout → Settings', passed: true, assertion: 'Original settings UI visible; route hash #settings' });
    await runtime.page.getByRole('button', { name: '布局', exact: true }).click();
    await runtime.page.getByRole('button', { name: '启动服务', exact: true }).click();
    await runtime.page.getByText(/纯设计预览：网络请求 POST/).first().waitFor();
    const nativeGlobals = await runtime.page.evaluate(() => ({ native: '__TAURI_INTERNALS__' in window || '__TAURI__' in window, blocked: (window as any).__RDESIGN_DESIGN_PREVIEW__.diagnostics.blocked }));
    assert.equal(nativeGlobals.native, false);
    assert(nativeGlobals.blocked.some((entry: string) => entry.includes('/__rshare/service')));
    results.interactions.push({ name: 'Start service stays unavailable', passed: true, assertion: 'No native globals; service request rejected; original error UI shown' });
  } else if (name === 'R-Link') {
    const expand = runtime.page.getByRole('button', { name: '展开侧栏', exact: true });
    if (await expand.count()) await expand.click();
    await runtime.page.getByText('设备管理', { exact: true }).first().click();
    await runtime.page.getByText('设备管理', { exact: true }).first().waitFor();
    assert.equal(new URL(runtime.page.url()).hash, '#remote');
    const state = await runtime.page.evaluate(() => (window as any).__RDESIGN_DESIGN_PREVIEW__);
    assert(state.diagnostics.blocked.length > 0);
    results.interactions.push({ name: 'Topology → device management', passed: true, assertion: 'Original route switches; API errors stay unavailable with no authenticated user session' });
    const rejected = await runtime.page.evaluate(async () => { const api = await import('/src/utils/tauriWindow.ts'); try { await api.withTauriWindow(() => {}); return false; } catch (error) { return String(error).includes('纯设计预览'); } });
    assert(rejected);
    results.interactions.push({ name: 'Native window helper is unavailable', passed: true, assertion: 'Browser helper rejects instead of returning a simulated native success' });
  }
  await runtime.page.goto('about:blank');
  await runtime.page.goto(runtime.url() + config.scenarios[0].route, { waitUntil: 'networkidle' });
  await runtime.page.waitForSelector(config.scenarios[0].readySelector, { timeout: 15000 });
  const index = await indexSources(output);
  const visibleFrame = await runtime.capture('snapshot');
  const visibleIds = new Set(visibleFrame.nodes.filter(node => node.binding?.reliability === 'exact').map(node => node.binding!.sourceNodeId));
  const candidates = [...index.values()].flat().filter(entry => visibleIds.has(entry.binding.sourceNodeId) && entry.binding.file !== 'src/main.tsx' && entry.binding.reliability === 'exact' && entry.binding.editableProperties.length > 0);
  assert(candidates.length > 0, 'Original visible UI must have a safe editable mapping');
  const sample = candidates.find(entry => entry.binding.editableProperties.includes('text')) ?? candidates.find(entry => entry.binding.editableProperties.includes('fontSize'))!;
  assert(sample, 'A visible literal text or static inline style must be editable');
  const edit = sample.binding.editableProperties.includes('text') ? { text: 'R-Design mapping acceptance' } : { fontSize: 17 };
  const changed = transform(sample, edit);
  assert(changed.after !== sample.source);
  results.sourceMapping = { passed: true, file: sample.binding.file, line: sample.binding.line, allowedProperties: sample.binding.editableProperties, checkedProperty: Object.keys(edit)[0], checked: 'Original visible JSX literal text or static inline style transformation; validation only, no source write', readonly: 'Dynamic/i18n text, theme expressions and unbound canvas internals remain read-only' };
  for (const asset of provenance.assetSegments) {
    const encoded = (await Promise.all(asset.segments.map((segment: string) => readFile(path.join(output, segment), 'utf8')))).join('');
    const original = await readFile(path.join(repoRoot, '../sources', name, asset.upstream));
    assert(Buffer.from(encoded, 'base64').equals(original));
  }
  results.assets = { passed: true, losslessSegmentedAssets: provenance.assetSegments.length };
  if (process.env.RDESIGN_CANDIDATE_REHEARSAL === 'true') {
    const { DocumentStore } = await hostModule('packages/document-core/src/index.ts');
    const { ChangeEngine } = await hostModule('packages/change-engine/src/index.ts');
    const dataRoot = path.join(repoRoot, '.rdesign/desktop-candidate', name, randomUUID());
    const store = await new DocumentStore(dataRoot).load(visibleFrame.codeRevision);
    store.project.scenarios = structuredClone([...config.scenarios.slice(1), config.scenarios[0]]);
    const engine = new ChangeEngine(store, runtime, frozenRoot);
    const target = visibleFrame.nodes.find(node => node.binding?.reliability === 'exact' && node.sourceNodeId === sample.binding.sourceNodeId);
    assert(target);
    const request = { projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId, version: visibleFrame, intent: 'Rehearse a literal mapped property in an isolated copy', properties: edit, scope: 'instance' };
    const change = await store.write(request, 'candidate-prepare', () => engine.prepare(request));
    await engine.verify(change.id);
    assert.equal(change.status, 'failed', 'Unregistered dependency support must not be reported as an official candidate pass');
    const candidateRoot = engine.candidateRoot(change.id);
    await symlink(dependencyRoot, path.join(candidateRoot, 'node_modules'), 'dir');
    const candidate = new FrozenPreviewRuntime(name, candidateRoot, 'candidate');
    try {
      await candidate.start();
      await candidate.page.setViewportSize(config.scenarios[0].viewport);
      await candidate.page.goto(candidate.url() + config.scenarios[0].route, { waitUntil: 'networkidle' });
      await candidate.page.waitForSelector(config.scenarios[0].readySelector, { timeout: 15000 });
      const locator = candidate.page.locator(`[data-rdesign-id="${sample.binding.sourceNodeId}"]`);
      if ('text' in edit) assert.equal((await locator.textContent())?.trim(), edit.text);
      else assert.equal(await locator.evaluate(element => (element as HTMLElement).style.fontSize), '17px');
      const frame = await candidate.capture('candidate');
      assert.notEqual(frame.codeRevision, visibleFrame.codeRevision);
      await writeFile(path.join(destination, 'candidate-preview.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
      await writeFile(path.join(destination, 'candidate-preview.frame.json'), JSON.stringify(frame));
      assert.equal(await codeHash(output), visibleFrame.codeRevision, 'The delivered application source must stay unchanged');
      results.candidate = { preparation: 'passed actual frozen ChangeEngine.prepare', frozenVerification: 'blocked', frozenError: change.error?.split('\n')[0], compatibilityPreview: 'passed actual changed DOM property', property: Object.keys(edit)[0], sourceFile: sample.binding.file, originalSourceUnchanged: true, accept: 'not run because official verification failed', revert: 'not run; original source was never changed', screenshot: 'candidate-preview.png' };
    } finally { await candidate.close(); }
    engine.discard(change.id); await store.save();
  }
  results.pageErrors = errors;
  assert.equal(errors.length, 0, 'No uncaught browser errors');
  results.runtime = 'passed isolated headless Chromium; ephemeral loopback port';
  if (!results.productionBuild) await runtime.build();
  results.productionBuild = 'passed';
} catch (error) {
  results.failure = String(error); results.pageErrors = errors; process.exitCode = 1;
  if (runtime.page) { await runtime.page.screenshot({ path: path.join(destination, 'failure.png') }).catch(() => {}); results.bootErrors = await runtime.page.locator('[data-rdesign-boot-error]').evaluateAll(elements => elements.map(element => element.getAttribute('data-rdesign-boot-error'))); results.dom = (await runtime.page.locator('body').innerText().catch(() => '')).slice(0, 6000); }
} finally {
  await runtime.close();
  await writeFile(path.join(destination, 'validation.json'), JSON.stringify(results, null, 2) + '\n');
  const { dom, ...summary } = results;
  await writeFile(path.join(repoRoot, 'projects', name, 'validation-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
