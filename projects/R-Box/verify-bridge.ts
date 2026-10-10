import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { independentPort } from './browser-assertions';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const [toolDirectory, commit, ...requested] = process.argv.slice(2);
assert.ok(toolDirectory && /^[0-9a-f]{40}$/.test(commit ?? ''), 'Usage: verify-bridge.ts <tool-checkout-or-archive> <exact-tool-sha> [projects...]');
const toolRoot = path.resolve(toolDirectory);
const names = requested.length ? requested : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'SaveDock'];
await mkdir(path.join(deliveryRoot, 'bridge-evidence'), { recursive: true });

for (const name of names) {
  const output = path.join(deliveryRoot, 'bridge-evidence', name);
  await mkdir(output, { recursive: true });
  const runRoot = await mkdtemp(path.join(output, 'run-'));
  const dataDirectory = path.join(runRoot, '.rdesign');
  const port = await independentPort();
  let previewPort = await independentPort();
  while (previewPort === port) previewPort = await independentPort();
  const base = 'http://127.0.0.1:' + port;
  let child: ChildProcess | undefined, browser: Browser | undefined, token = '';
  const report: any = { name, testedHostSha: commit, runRoot, dataDirectory, port, previewPort, guiImport: 'pending', runtime: 'pending', mapping: 'pending', restart: 'pending', failures: [] };
  const request = async (route: string) => {
    const response = await fetch(base + '/api' + route, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(route + ': ' + (result.error?.code ?? response.status));
    return result;
  };
  const poll = async (read: () => Promise<any>, predicate: (value: any) => boolean, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Readiness timeout');
  };
  const launch = () => {
    // Inherit only process/runtime essentials, never external service credentials.
    const inherited = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'RDESIGN_BROWSER'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/bridge/src/index.ts'], { cwd: toolRoot, env: { ...inherited, RDESIGN_PORT: String(port), RDESIGN_FIXTURE_PORT: String(previewPort), RDESIGN_DATA_DIR: dataDirectory, RDESIGN_WORKSPACE: path.join(toolRoot, 'fixtures/react-monitor') }, stdio: ['ignore', 'pipe', 'pipe'] });
    // Consume bootstrap/pairing output without storing or printing tokens.
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
  };
  const ready = async () => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child?.exitCode !== null) throw new Error('Owned Bridge process exited');
      try { token = (await request('/bootstrap')).token; const state = await request('/state'); if (state.frame?.status === 'live') return state; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Owned Bridge startup timeout');
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const ownedChild = child;
    const exited = once(ownedChild, 'exit'); ownedChild.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(() => { if (ownedChild.exitCode === null) ownedChild.kill('SIGKILL'); resolve(undefined); }, 8000); timer.unref(); })]);
  };
  try {
    launch(); await ready();
    try { browser = await chromium.launch({ headless: true }); } catch (error) { if (!existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) throw error; browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByTestId('home-page').waitFor({ timeout: 45000 });
    const previous = await request('/projects');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('project-home-import').click();
    await (await chooser).setFiles(path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json'));
    const catalog = await poll(() => request('/projects'), value => value.projects.length === previous.projects.length + 1);
    const imported = catalog.projects.find((project: any) => !previous.projects.some((before: any) => before.id === project.id));
    assert.ok(imported);
    await page.getByTestId('open-project-' + imported.id).click();
    await page.getByTestId('canvas-surface').waitFor({ timeout: 45000 });
    const state = await poll(() => request('/state'), value => value.project.id === imported.id && value.frame?.status === 'live');
    const mapped = state.frame.nodes.find((node: any) => node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact' && node.binding.editableProperties.includes('text'));
    assert.ok(mapped);
    assert.ok(state.project.scenarios.every((scenario: any) => scenario.status === 'unverified'));
    assert.ok(state.project.snapshots.length > 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'workbench.png'), fullPage: true });
    report.guiImport = 'passed'; report.runtime = 'passed'; report.mapping = 'passed';
    report.importedId = imported.id; report.sourceDirectory = imported.location; report.scenes = state.project.scenarios.length; report.historicalSnapshots = state.project.snapshots.length; report.scenariosUnverified = true; report.frameNodeCount = state.frame.nodes.length;
    const oldSession = state.frame.runtimeSessionId;
    await browser.close(); browser = undefined; await stop(); token = '';
    launch(); const restored = await ready();
    assert.equal(restored.project.id, imported.id);
    assert.notEqual(restored.frame.runtimeSessionId, oldSession);
    assert.equal((await request('/projects')).activeProjectId, imported.id);
    assert.ok(restored.frame.nodes.some((node: any) => node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact'));
    report.restart = 'passed'; report.restoredId = restored.project.id; report.freshRuntimeSession = true;
  } catch (error) { report.failures.push(String(error)); }
  finally { await browser?.close(); await stop(); }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, guiImport: report.guiImport, runtime: report.runtime, mapping: report.mapping, restart: report.restart, failures: report.failures }));
}
