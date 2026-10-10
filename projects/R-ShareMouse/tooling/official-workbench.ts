import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './prepare.mjs';
import { frozenRoot, frozenSha, hostModule } from './frozen-host.mjs';

const { chromium } = await hostModule('node_modules/playwright/index.mjs');
const names = process.argv.slice(2); assert(names.length > 0);
async function freePort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); assert(address && typeof address !== 'string'); return address.port; }
for (const name of names) {
  const folder = path.join(repoRoot, 'projects', name);
  const adapter = JSON.parse(await readFile(path.join(folder, 'adapter.json'), 'utf8'));
  const parent = path.join(repoRoot, '.rdesign/desktop-official-workbench', name); await mkdir(parent, { recursive: true });
  const runRoot = await mkdtemp(path.join(parent, 'run-')), dataRoot = path.join(runRoot, 'data');
  const port = await freePort(); let previewPort = await freePort(); while (previewPort === port) previewPort = await freePort();
  const base = `http://127.0.0.1:${port}`, bundleFile = path.join(repoRoot, '.rdesign/desktop-official-deliverables', `${name}.${frozenSha.slice(0, 7)}.rdesign-project.json`);
  const report: any = { name, testedHostSha: frozenSha, extensionMergedIntoMain: false, source: adapter.source, runRoot, mode: 'Actual Workbench file chooser, official Bridge and fresh process restart; headless browsers and independent loopback ports', checks: [], clientPageErrors: [], failures: [] };
  let child: any, browser: any, token = '';
  async function request(route: string, body?: any) {
    const response = await fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    const value = await response.json(); if (!response.ok) throw new Error(`${route}: ${value.error?.code ?? response.status} ${value.error?.message ?? ''}`); return value;
  }
  async function poll(read: () => Promise<any>, predicate: (value: any) => boolean, timeout = 60000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error('Workbench readiness timeout'); }
  function launch() {
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/bridge/src/index.ts'], { cwd: frozenRoot, env: { ...process.env, RDESIGN_PORT: String(port), RDESIGN_FIXTURE_PORT: String(previewPort), RDESIGN_DATA_DIR: dataRoot, RDESIGN_WORKSPACE: path.join(frozenRoot, 'fixtures/react-monitor') }, stdio: ['ignore', 'pipe', 'pipe'] });
    // Never emit bootstrap/pairing tokens or inherited credentials.
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  }
  async function ready() {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Bridge exited with code ' + child.exitCode);
      try { token = (await request('/bootstrap')).token; const state = await request('/state'); if (state.frame?.status === 'live') return state; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Actual Bridge startup timed out');
  }
  async function stop() { if (!child || child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(undefined); }, 8000).unref())]); }
  async function browserPage() {
    try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => report.clientPageErrors.push(error.message)); return page;
  }
  try {
    launch(); const initial = await ready(); const page = await browserPage();
    await page.goto(base); await page.getByTestId('home-page').waitFor();
    const before = await request('/projects');
    const chooser = page.waitForEvent('filechooser'); await page.getByTestId('project-home-import').click(); await (await chooser).setFiles(bundleFile);
    const catalog = await poll(() => request('/projects'), value => value.projects.length === before.projects.length + 1);
    const imported = catalog.projects.find(project => !before.projects.some(previous => previous.id === project.id)); assert(imported);
    await page.getByTestId(`open-project-${imported.id}`).click(); await page.getByTestId('canvas-surface').waitFor({ timeout: 60000 });
    const state = await poll(() => request('/state'), value => value.project.id === imported.id && value.frame?.status === 'live');
    assert(state.frame.nodes.filter(node => node.binding?.reliability === 'exact' && node.binding.file !== 'src/main.tsx').length > 10);
    assert(state.project.scenarios.every(scene => scene.status === 'unverified'));
    const editorUrl = page.url();
    await page.screenshot({ path: path.join(runRoot, 'workbench-imported.png'), fullPage: true });
    report.checks.push({ name: 'Actual Workbench file chooser import/open/live source mappings', passed: true, importedId: imported.id, incomingScenes: state.project.scenarios.length, originalSourceNodes: state.frame.nodes.filter(node => node.binding?.reliability === 'exact' && node.binding.file !== 'src/main.tsx').length });
    for (const scene of state.project.scenarios) {
      const current = await request('/state');
      const frame = await request(`/scenarios/${encodeURIComponent(scene.id)}/capture`, { projectId: imported.id, expectedRevision: current.project.revision, operationId: randomUUID() });
      assert.equal(frame.width, scene.viewport.width); assert.equal(frame.height, scene.viewport.height);
      await writeFile(path.join(runRoot, `bridge-${scene.id}.png`), Buffer.from(frame.image.split(',')[1], 'base64'));
      report.checks.push({ name: `Actual Bridge scene ${scene.id}`, passed: true, viewport: scene.viewport, snapshotId: frame.id });
    }
    const captured = await request('/state'); assert.equal(captured.project.snapshots.length, state.project.scenarios.length);
    const previousSession = captured.frame.runtimeSessionId;
    await browser.close(); browser = undefined; await stop(); token = '';
    launch(); const restored = await ready();
    assert.equal(restored.project.id, imported.id); assert.notEqual(restored.frame.runtimeSessionId, previousSession);
    assert.equal(restored.project.snapshots.length, state.project.scenarios.length);
    assert.equal((await request('/projects')).activeProjectId, imported.id);
    const reopened = await browserPage(); await reopened.goto(editorUrl); await reopened.getByTestId('canvas-surface').waitFor({ timeout: 60000 });
    await reopened.screenshot({ path: path.join(runRoot, 'workbench-restarted.png'), fullPage: true });
    assert.deepEqual(report.clientPageErrors, []);
    report.checks.push({ name: 'Fresh Bridge + Workbench browser restart restores active project and saved snapshots', passed: true, importedId: imported.id, oldSession: previousSession, newSession: restored.frame.runtimeSessionId, restoredSnapshots: restored.project.snapshots.length, originalLegacyProject: initial.project.id });
    report.passed = true; console.log(`${name}: actual Workbench import/scenes/restart passed`);
  } catch (error) { report.passed = false; report.failures.push({ message: (error as Error).message, stack: (error as Error).stack }); process.exitCode = 1; console.error((error as Error).stack); }
  finally { await browser?.close(); await stop(); await writeFile(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await writeFile(path.join(folder, 'official-workbench-summary.json'), JSON.stringify(report, null, 2) + '\n'); }
}
