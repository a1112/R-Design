import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser } from 'playwright';
import { DocumentStore } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { projectPackage } from '../../packages/project-workspace/src/index';
import type { BridgeState, RuntimeFrame, Scenario } from '../../packages/protocol/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const source = `import React from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';
function App(){const selected=new URLSearchParams(location.search).get('scene');return <main><button data-rdesign-id="start-button">Example</button>{selected==='a'?<h2 data-rdesign-id="a-title">Scene A</h2>:selected==='b'?<h2 data-rdesign-id="b-title">Scene B</h2>:<h2 data-rdesign-id="home">Home</h2>}</main>}
createRoot(document.getElementById('root')).render(<App/>);installRuntime();`;
async function freePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (ready(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Synthetic Bridge readiness timeout');
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

it('recovers failed registered recipes through the real Bridge endpoint and original Workbench scenario button', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'rd-scenario-recovery-'));
  const root = path.join(temporary, 'source'), data = path.join(temporary, 'data');
  let child: ChildProcess | undefined, browser: Browser | undefined, token = '';
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    const main = path.join(root, 'src/main.tsx');
    await writeFile(main, source); await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage()));
    await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    const store = await new DocumentStore(data).load(await codeHash(root));
    const scenes: Scenario[] = ['a', 'b'].map(id => ({ id, name: 'Scene ' + id.toUpperCase(), route: '/?scene=' + id, viewport: { width: 390, height: 844 }, steps: [], readySelector: `[data-rdesign-id="${id}-title"]`, dependencies: ['src/main.tsx'], status: 'unverified' }));
    store.project.scenarios = scenes; await store.save();
    const port = await freePort(), previewPort = await freePort(), base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/bridge/src/index.ts'], { cwd: host,
      env: { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : [])), RDESIGN_PORT: String(port), RDESIGN_FIXTURE_PORT: String(previewPort), RDESIGN_WORKSPACE: root, RDESIGN_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const request = async (route: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
      const response = await fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
      return { status: response.status, value: await response.json() };
    };
    const state = async () => { const result = await request('/state'); expect(result.status).toBe(200); return result.value as BridgeState; };
    await poll(async () => {
      if (child!.exitCode !== null) throw new Error('Synthetic Bridge exited');
      try { token = (await request('/bootstrap')).value.token; return await state(); } catch { return null; }
    }, value => value?.frame?.status === 'live');
    const mutation = async (route: string) => { const current = await state(); return request(route, { projectId: current.project.id, expectedRevision: current.project.revision, operationId: crypto.randomUUID() }); };
    const first = await mutation('/scenarios/a/capture'); expect(first.status).toBe(200);
    expect((first.value as RuntimeFrame).nodes.some(node => node.sourceNodeId === 'a-title')).toBe(true);
    await writeFile(main, source.replace('data-rdesign-id="a-title"', 'data-rdesign-id="a-missing"'));
    const failed = await poll(state, value => value.frame?.status === 'build-failed');
    expect(failed.capabilities.input).toBe(false);
    const unknown = await mutation('/scenarios/not-registered/capture'); expect(unknown.status).toBe(404); expect(unknown.value.error.code).toBe('SCENARIO_NOT_FOUND');
    const forbidden = await request('/scenarios/b/capture', { projectId: failed.project.id, expectedRevision: failed.project.revision, operationId: crypto.randomUUID() }, { Origin: 'http://synthetic-untrusted.invalid' });
    expect(forbidden.status).toBe(403); expect(forbidden.value.error.code).toBe('ORIGIN_FORBIDDEN');
    const recovered = await mutation('/scenarios/b/capture'); expect(recovered.status).toBe(200);
    expect(recovered.value.nodes.find((node: any) => node.sourceNodeId === 'b-title')?.text).toBe('Scene B');
    expect(recovered.value.codeRevision).toBe(await codeHash(root));
    await poll(state, value => value.frame?.status === 'live' && value.project.codeRevision === recovered.value.codeRevision);

    // Fail another remembered recipe, then recover via the original UI request.
    await writeFile(main, source); expect((await mutation('/scenarios/a/capture')).status).toBe(200);
    await writeFile(main, source.replace('data-rdesign-id="a-title"', 'data-rdesign-id="a-missing"').replace('Scene B', 'Scene B from Workbench'));
    await poll(state, value => value.frame?.status === 'build-failed');
    try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + '/editor', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '页面', exact: true }).click();
    const responsePromise = page.waitForResponse(response => response.url() === base + '/api/scenarios/b/capture' && response.request().method() === 'POST');
    await page.getByTestId('scenario-b').click();
    const uiResponse = await responsePromise; expect(uiResponse.status()).toBe(200);
    const uiFrame = await uiResponse.json();
    expect(uiFrame.nodes.find((node: any) => node.sourceNodeId === 'b-title')?.text).toBe('Scene B from Workbench');
    expect(uiFrame.codeRevision).toBe(await codeHash(root));
    await page.waitForFunction(() => document.querySelector('[data-testid="scenario-b"] small')?.textContent?.includes('最新快照'));
    const current = await poll(state, value => value.frame?.status === 'live' && value.project.codeRevision === uiFrame.codeRevision);
    expect(current.project.scenarios.find(scene => scene.id === 'b')?.snapshotId).toBe(uiFrame.id);
    expect(current.project.scenarios.find(scene => scene.id === 'b')?.status).toBe('fresh');
    const evidence = process.env.RDESIGN_RECOVERY_EVIDENCE;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, 'workbench-recovered.png') });
      await writeFile(path.join(evidence, 'recovery.json'), JSON.stringify({ registeredSceneRecovery: true, unknownScene: unknown.value.error.code, badOrigin: forbidden.value.error.code, endpoint: { status: recovered.status, codeRevision: recovered.value.codeRevision }, originalWorkbench: { status: uiResponse.status(), target: 'b-title', text: 'Scene B from Workbench', codeRevision: uiFrame.codeRevision }, failedInputDisabled: true, privateDataRoot: temporary }, null, 2) + '\n');
    }
  } finally { await browser?.close(); await stop(child); await rm(temporary, { recursive: true, force: true }); }
}, 120000);
