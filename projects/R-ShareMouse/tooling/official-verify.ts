import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './prepare.mjs';
import { frozenRoot, frozenSha, hostModule } from './frozen-host.mjs';

const { ProjectWorkspace, validatePortableProjectBundle } = await hostModule('packages/project-workspace/src/index.ts');
const { preflightEngineeringBundle } = await hostModule('packages/project-workspace/src/engineering.ts');
const { DocumentStore, digest } = await hostModule('packages/document-core/src/index.ts');
const { codeHash } = await hostModule('packages/source-binding/src/index.ts');
const { BrowserRuntime } = await hostModule('apps/bridge/src/runtime.ts');
const { captureScenario } = await hostModule('packages/scenario-runner/src/index.ts');
const { ChangeEngine } = await hostModule('packages/change-engine/src/index.ts');
const name = process.argv[2];
assert(name && /^[A-Za-z0-9_-]+$/.test(name));
const folder = path.join(repoRoot, 'projects', name);
const adapter = JSON.parse(await readFile(path.join(folder, 'adapter.json'), 'utf8'));
const bundleFile = path.join(repoRoot, '.rdesign/desktop-official-deliverables', `${name}.${frozenSha.slice(0, 7)}.rdesign-project.json`);
const bytes = await readFile(bundleFile), bundle = JSON.parse(bytes.toString('utf8'));
const parent = path.join(repoRoot, '.rdesign/desktop-official-validation', name); await mkdir(parent, { recursive: true });
const runRoot = await mkdtemp(path.join(parent, 'run-'));
const report: any = { name, testedHostSha: frozenSha, extensionMergedIntoMain: false, source: adapter.source, bundle: { file: bundleFile, checksum: bundle.checksum, fileSha256: digest(bytes), bytes: bytes.length, sourceFiles: bundle.sourceFiles.length }, mode: 'Actual official ProjectWorkspace, BrowserRuntime, scenario runner and ChangeEngine; no runtime overrides or project dependency installations', runRoot, scenes: [], interactions: [], pageErrors: [], externalRequests: [], failures: [], nativeBackend: 'unavailable; no native/backend capability accepted' };
let runtime: any, candidateLive: any;
try {
  validatePortableProjectBundle(bundle); report.preflight = preflightEngineeringBundle(bundle); assert(report.preflight.passed);
  const linked = path.join(frozenRoot, 'fixtures/react-monitor'), data = path.join(runRoot, 'catalog');
  const seed = await new DocumentStore(data).load(await codeHash(linked));
  const catalog = await new ProjectWorkspace(data, linked, frozenRoot).load(seed.project);
  const imported = await catalog.import(bundle), independent = await catalog.import(bundle);
  assert.notEqual(imported.id, bundle.manifest.id); assert.notEqual(imported.id, independent.id);
  const first = await catalog.validate(imported.id), second = await catalog.validate(independent.id);
  assert.notEqual(first.sourceDirectory, second.sourceDirectory);
  for (const entry of [first, second]) for (const file of bundle.sourceFiles) if (file.path !== 'package.json') assert.equal(digest(await readFile(path.join(entry.sourceDirectory, file.path))), file.sha256);
  const store = await new DocumentStore(first.dataDirectory).load(await codeHash(first.sourceDirectory));
  assert(store.project.scenarios.every(scene => scene.status === 'unverified'));
  const originalRevision = await codeHash(first.sourceDirectory);
  report.import = { passed: true, ids: [imported.id, independent.id], distinctSourceDirectories: true, incomingEvidenceStatus: 'unverified', preservedFiles: bundle.sourceFiles.length - 1 };
  runtime = new BrowserRuntime(first.sourceDirectory, frozenRoot, 'live', 0, first.dataDirectory);
  await runtime.build(); report.productionBuild = 'passed'; await runtime.start();
  runtime.page.setDefaultTimeout(15000);
  runtime.page.on('pageerror', error => report.pageErrors.push(error.message));
  runtime.page.on('request', request => { const url = new URL(request.url()); if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== runtime.url()) report.externalRequests.push(url.origin + url.pathname); });
  for (const scene of store.project.scenarios) {
    const frame = await captureScenario(runtime, scene);
    assert.equal(await runtime.page.locator('[data-rdesign-boot-error]').count(), 0);
    const mapped = frame.nodes.filter(node => node.binding?.reliability === 'exact' && node.binding.file !== 'src/main.tsx');
    assert(mapped.length > 10, 'The original source UI must retain real source mappings');
    await writeFile(path.join(runRoot, `${scene.id}.png`), Buffer.from(frame.image.split(',')[1], 'base64'));
    await writeFile(path.join(runRoot, `${scene.id}.frame.json`), JSON.stringify(frame));
    const snapshot = await store.snapshot(frame); scene.snapshotId = snapshot.id; scene.status = 'fresh';
    report.scenes.push({ id: scene.id, passed: true, viewport: scene.viewport, screenshot: `${scene.id}.png`, frameCodeRevision: frame.codeRevision, nodes: frame.nodes.length, exactOriginalSourceNodes: mapped.length, clippedControls: await runtime.page.evaluate(() => [...document.querySelectorAll('button,input,select')].filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && (r.x < 0 || r.right > innerWidth); }).length) });
    console.log(`${name}: official scene ${scene.id} passed`);
  }
  await store.save(); await catalog.refresh(imported.id, store.project);
  await runtime.page.setViewportSize(bundle.document.project.scenarios[0].viewport);
  await runtime.page.goto(runtime.url() + bundle.document.project.scenarios[0].route, { waitUntil: 'networkidle' });
  if (name === 'R-ShareMouse') {
    await runtime.page.getByRole('button', { name: '设置', exact: true }).click();
    await runtime.page.getByText('界面风格', { exact: true }).waitFor(); assert.equal(new URL(runtime.page.url()).hash, '#settings');
    report.interactions.push({ name: 'Original layout → settings route', passed: true });
    await runtime.page.getByRole('button', { name: '布局', exact: true }).click();
    await runtime.page.getByRole('button', { name: '启动服务', exact: true }).click();
    await runtime.page.getByText(/纯设计预览：网络请求 POST/).first().waitFor();
    const state = await runtime.page.evaluate(() => ({ native: '__TAURI_INTERNALS__' in window || '__TAURI__' in window, blocked: (window as any).__RDESIGN_DESIGN_PREVIEW__.diagnostics.blocked }));
    assert.equal(state.native, false); assert(state.blocked.some(value => value.includes('/__rshare/service')));
    report.interactions.push({ name: 'Start service rejects with original unavailable UI', passed: true, nativeSuccess: false });
  } else if (name === 'R-Link') {
    const expand = runtime.page.getByRole('button', { name: '展开侧栏', exact: true }); if (await expand.count()) await expand.click();
    await runtime.page.getByText('设备管理', { exact: true }).first().click(); assert.equal(new URL(runtime.page.url()).hash, '#remote');
    assert((await runtime.page.evaluate(() => (window as any).__RDESIGN_DESIGN_PREVIEW__.diagnostics.blocked)).length > 0);
    report.interactions.push({ name: 'Original topology → device-management route', passed: true });
    const rejected = await runtime.page.evaluate(async () => { const api = await import('/src/utils/tauriWindow.ts'); try { await api.withTauriWindow(() => {}); return false; } catch (error) { return String(error).includes('纯设计预览'); } });
    assert(rejected); report.interactions.push({ name: 'Native window helper explicitly rejects', passed: true, nativeSuccess: false });
  } else if (adapter.source.visibility === 'private') {
    const hooks = await import(pathToFileURL(path.join(repoRoot, '.rdesign/desktop-adapters/official-assertions.mjs')).href);
    report.interactions.push(...await hooks.interactions(name, runtime));
  } else throw new Error('No registered business assertions for this project');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  assert.equal(await codeHash(first.sourceDirectory), originalRevision);
  await runtime.close(); runtime = undefined;

  const secondStore = await new DocumentStore(second.dataDirectory).load(await codeHash(second.sourceDirectory));
  candidateLive = new BrowserRuntime(second.sourceDirectory, frozenRoot, 'live', 0, second.dataDirectory); await candidateLive.start();
  const scene = secondStore.project.scenarios[0];
  await candidateLive.page.setViewportSize(scene.viewport); await candidateLive.page.goto(candidateLive.url() + scene.route, { waitUntil: 'networkidle' });
  await candidateLive.page.locator(scene.readySelector).waitFor();
  const frame = await candidateLive.capture();
  const target = frame.nodes.find(node => node.binding?.reliability === 'exact' && node.binding.file !== 'src/main.tsx' && !node.binding.file.startsWith('src/rdesign') && node.binding.editableProperties.includes('text') && node.text?.trim());
  assert(target, 'A visible literal original-source text must be editable');
  const engine = new ChangeEngine(secondStore, candidateLive, frozenRoot);
  const request = { projectId: secondStore.project.id, expectedRevision: secondStore.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId, version: frame, intent: '正式导入后的单实例文字验收', properties: { text: 'R-Design 正式验收' }, scope: 'instance' };
  await assert.rejects(() => engine.prepare({ ...request, scope: 'shared' }), error => error.code === 'SCOPE_UNSUPPORTED');
  const change = await secondStore.write(request, 'official-prepare', () => engine.prepare(request));
  await secondStore.write({ projectId: secondStore.project.id, expectedRevision: secondStore.project.revision, operationId: randomUUID() }, 'official-verify', () => engine.verify(change.id));
  assert.equal(change.status, 'verified', JSON.stringify({ error: change.error, evidence: change.evidence.map(e => ({ name: e.name, passed: e.passed, detail: e.detail })) }));
  assert(change.evidence.every(evidence => evidence.passed));
  await secondStore.write({ projectId: secondStore.project.id, expectedRevision: secondStore.project.revision, operationId: randomUUID() }, 'official-apply', () => engine.apply(change.id, change.diffHash));
  const accepted = await candidateLive.capture(); assert(accepted.nodes.some(node => node.sourceNodeId === target.sourceNodeId && node.text?.trim() === request.properties.text));
  await writeFile(path.join(runRoot, 'candidate-accepted.png'), Buffer.from(accepted.image.split(',')[1], 'base64'));
  await secondStore.write({ projectId: secondStore.project.id, expectedRevision: secondStore.project.revision, operationId: randomUUID() }, 'official-revert', () => engine.revert(change.id));
  const restored = await candidateLive.capture(); assert(restored.nodes.some(node => node.sourceNodeId === target.sourceNodeId && node.text === target.text));
  assert.equal(change.status, 'reverted'); assert.equal(await codeHash(first.sourceDirectory), originalRevision);
  await writeFile(path.join(runRoot, 'candidate-reverted.png'), Buffer.from(restored.image.split(',')[1], 'base64'));
  await catalog.refresh(independent.id, secondStore.project, restored);
  const reopened = await new DocumentStore(second.dataDirectory).load(await codeHash(second.sourceDirectory));
  assert.equal(reopened.changes.find(item => item.id === change.id)?.status, 'reverted');
  report.candidate = { passed: true, prepare: 'passed', verify: 'passed actual build and registered scenarios', accept: 'passed actual DOM readback', revert: 'passed semantic text restoration', byteIdenticalRevert: 'not asserted', originalText: target.text, sourceBinding: target.binding, sharedScopeRejected: true, persistedStatus: change.status, independentProjectUnchanged: true, evidence: change.evidence.map(e => ({ name: e.name, passed: e.passed, detail: e.detail })) };
  report.passed = true; console.log(`${name}: official import/build/business/candidate accept and semantic revert passed`);
} catch (error) {
  report.passed = false; report.failures.push({ code: (error as any).code, message: (error as Error).message, stack: (error as Error).stack }); process.exitCode = 1;
  console.error((error as Error).stack);
} finally {
  await runtime?.close(); await candidateLive?.close();
  await writeFile(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(folder, 'official-validation-summary.json'), JSON.stringify(report, null, 2) + '\n');
}
