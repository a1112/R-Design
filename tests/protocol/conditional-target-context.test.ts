import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';
import { DocumentStore } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { projectPackage } from '../../packages/project-workspace/src/index';
import { captureScenario, verifyScenarios } from '../../packages/scenario-runner/src/index';
import type { Scenario } from '../../packages/protocol/src/index';

const host = path.resolve(import.meta.dirname, '../..'), roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const source = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';
function App(){const[route,setRoute]=useState(location.hash),[tab,setTab]=useState('overview'),[details,setDetails]=useState(false);
useEffect(()=>{const read=()=>setRoute(location.hash);addEventListener('hashchange',read);return()=>removeEventListener('hashchange',read)},[]);
return <main><button data-rdesign-id="home" onClick={()=>{location.hash=''}}>Home</button>{route==='#workspace'?<section>
<button data-rdesign-id="open-settings" onClick={()=>setTab('settings')}>Settings tab</button>
{tab==='settings'&&<div><button data-rdesign-id="show-details" onClick={()=>{setDetails(true);if(new URLSearchParams(location.search).has('interrupt'))location.hash='#interrupted'}}>Show details</button>
{details&&<h2 data-rdesign-id="settings-title">Original settings</h2>}<input type="password" aria-label="Private field"/></div>}</section>:
route==='#interrupted'?<p data-rdesign-id="interrupted">Navigation interrupted</p>:<p data-rdesign-id="overview">Overview</p>}</main>}
createRoot(document.getElementById('root')).render(<App/>);installRuntime();`;
const settings: Scenario = { id: 'conditional-settings', name: 'Conditional settings', route: '/?mode=conditional#workspace', viewport: { width: 390, height: 844 },
  steps: [{ action: 'click', target: 'open-settings' }, { action: 'click', target: 'show-details' }], readySelector: '[data-rdesign-id="settings-title"]', dependencies: ['src/main.tsx'], status: 'unverified' };
const overview: Scenario = { id: 'overview', name: 'Overview', route: '/', viewport: { width: 1200, height: 820 }, steps: [], readySelector: '[data-rdesign-id="overview"]', dependencies: ['src/main.tsx'], status: 'unverified' };

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-conditional-target-')); roots.push(directory);
  const root = path.join(directory, 'frontend'), data = path.join(directory, 'data'); await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/main.tsx'), source); await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage()));
  await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  const store = await new DocumentStore(data).load(await codeHash(root)); store.project.scenarios = structuredClone([settings, overview]);
  const runtime = new BrowserRuntime(root, host, 'live', 0, data); await runtime.start();
  return { root, data, store, runtime, engine: new ChangeEngine(store, runtime, host) };
}
async function prepare(engine: ChangeEngine, runtime: BrowserRuntime) {
  const frame = await captureScenario(runtime, settings), target = frame.nodes.find(node => node.sourceNodeId === 'settings-title')!;
  expect(target.binding?.reliability).toBe('exact');
  return engine.prepare({ projectId: engine.store.project.id, expectedRevision: engine.store.project.revision, operationId: randomUUID(),
    nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Change the original conditional settings title', properties: { text: 'Verified settings' }, scope: 'instance' });
}
async function title(runtime: BrowserRuntime) { return runtime.page.locator('[data-rdesign-id="settings-title"]').textContent(); }

describe('conditional page target verification', () => {
  it('restores route, viewport and registered steps after all scenes, then applies and reverts the original target', async () => {
    const f = await fixture();
    try {
      const change = await prepare(f.engine, f.runtime);
      await f.runtime.page.getByLabel('Private field').fill('synthetic-private-form-value');
      await f.runtime.page.evaluate(() => localStorage.setItem('private-example', 'synthetic-private-storage-value'));
      const metadata = await readFile(f.engine.metadataFile(change.id), 'utf8');
      expect(metadata).not.toContain('synthetic-private-form-value'); expect(metadata).not.toContain('synthetic-private-storage-value');
      const checks = await verifyScenarios(f.runtime, f.store.project.scenarios);
      expect(checks.every(check => check.passed)).toBe(true); expect(f.runtime.page.url()).toBe(f.runtime.url() + settings.route);
      expect(f.runtime.page.viewportSize()).toEqual(settings.viewport); expect(await title(f.runtime)).toBe('Original settings');
      await f.engine.verify(change.id); expect(change.status).toBe('verified');
      expect(change.evidence.some(check => check.name === '目标属性回读' && check.passed)).toBe(true);
      expect(change.candidateFrame?.nodes.find(node => node.sourceNodeId === 'settings-title')?.text).toBe('Verified settings');
      await f.engine.verify(change.id); expect(change.status).toBe('verified');
      const envelope = { projectId: f.store.project.id, expectedRevision: f.store.project.revision, operationId: 'conditional-apply' }; let executions = 0;
      await f.store.write(envelope, change.diffHash, () => { executions++; return f.engine.apply(change.id, change.diffHash); });
      await f.store.write(envelope, change.diffHash, () => { executions++; return f.engine.apply(change.id, change.diffHash); });
      expect(executions).toBe(1); await f.runtime.capture(); expect(await title(f.runtime)).toBe('Verified settings');
      expect(f.runtime.page.url()).toBe(f.runtime.url() + settings.route); expect(f.runtime.page.viewportSize()).toEqual(settings.viewport);
      await f.engine.revert(change.id); await f.runtime.capture(); expect(await title(f.runtime)).toBe('Original settings');
      expect(await codeHash(f.root)).toBe(f.store.project.codeRevision);
      const reverted = await readFile(path.join(f.root, 'src/main.tsx'), 'utf8');
      expect(reverted).toContain('Original settings'); expect(reverted).not.toContain('Verified settings');
      await expect(f.engine.revert(change.id)).rejects.toMatchObject({ code: 'CHANGE_STATE' });
    } finally { await f.runtime.close(); }
  }, 120000);

  it('persists the selected conditional context across runtime/store restart and leaves intervening live navigation alone', async () => {
    const f = await fixture(); let restarted: BrowserRuntime | undefined;
    try {
      const change = await prepare(f.engine, f.runtime); await f.store.save(); await f.runtime.close();
      const store = await new DocumentStore(f.data).load(await codeHash(f.root)); restarted = new BrowserRuntime(f.root, host, 'live', 0, f.data); await restarted.start();
      expect(await restarted.page.locator('[data-rdesign-id="settings-title"]').count()).toBe(0);
      const engine = new ChangeEngine(store, restarted, host);
      const verification = engine.verify(change.id);
      await restarted.page.goto(restarted.url() + '/?live=intervening#interrupted', { waitUntil: 'networkidle' });
      await verification; expect(engine.find(change.id).status).toBe('verified');
      expect(restarted.page.url()).toBe(restarted.url() + '/?live=intervening#interrupted');
      expect(engine.find(change.id).candidateFrame?.nodes.find(node => node.sourceNodeId === 'settings-title')?.text).toBe('Verified settings');
      await engine.apply(change.id, change.diffHash); await restarted.capture();
      expect(restarted.page.url()).toBe(restarted.url() + '/?live=intervening#interrupted');
      await captureScenario(restarted, settings); expect(await title(restarted)).toBe('Verified settings');
      await engine.revert(change.id); await restarted.capture(); expect(await title(restarted)).toBe('Original settings'); await store.save();
      const reloaded = await new DocumentStore(f.data).load(await codeHash(f.root)); expect(reloaded.changes.find(item => item.id === change.id)?.status).toBe('reverted');
    } finally { await restarted?.close(); await f.runtime.close(); }
  }, 120000);

  it('fails closed on navigation during target restoration and supports a clean retry without accepting the wrong page', async () => {
    const f = await fixture();
    try {
      const change = await prepare(f.engine, f.runtime), metadata = await f.engine.metadata(change);
      const interrupted = structuredClone(metadata);
      interrupted.viewContext!.scenario!.route = '/?interrupt=1#workspace';
      interrupted.viewContext!.scenario!.readySelector = '[data-rdesign-id="interrupted"]';
      await writeFile(f.engine.metadataFile(change.id), JSON.stringify(interrupted));
      await f.engine.verify(change.id); expect(change.status).toBe('failed');
      expect(change.error).toContain('导航'); await expect(f.engine.apply(change.id, change.diffHash)).rejects.toMatchObject({ code: 'UNVERIFIED_CHANGE' });
      expect(await readFile(path.join(f.root, 'src/main.tsx'), 'utf8')).toBe(source);
      await writeFile(f.engine.metadataFile(change.id), JSON.stringify(metadata)); await f.engine.verify(change.id);
      expect(change.status).toBe('verified'); expect(change.evidence.every(check => check.passed)).toBe(true);
      expect(change.candidateFrame?.nodes.find(node => node.sourceNodeId === 'settings-title')?.text).toBe('Verified settings');
      await f.runtime.page.goto(f.runtime.url() + '/#interrupted', { waitUntil: 'networkidle' });
      expect((await f.runtime.viewContext('settings-title')).scenario).toBeUndefined();
    } finally { await f.runtime.close(); }
  }, 120000);
});
