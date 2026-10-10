import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace, projectPackage, assertPortableSourcePaths } from '../../packages/project-workspace/src/index';
import { DocumentStore } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile), directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const dependencies = {
  react: '^19.1.0', 'react-dom': '^19.1.0',
  'lucide-react': '0.468.0', 'lucide-react-v0487': '0.487.0',
  '@radix-ui/react-context-menu': '2.3.7', clsx: '2.1.1', 'tailwind-merge': '3.7.0',
  'qrcode-generator': '1.5.2', 'framer-motion': '12.43.0', motion: '12.23.24',
  recharts: '2.15.4', sonner: '2.0.8', xterm: '5.3.0',
  'xterm-addon-fit': '0.8.0', 'xterm-addon-web-links': '0.9.0',
};

describe('controlled desktop browser dependencies', () => {
  it('keeps the icon generations separate and rejects peer-incompatible calendar, version ranges and private source names', async () => {
    expect(projectPackage(dependencies).dependencies).toMatchObject(dependencies);
    for (const declaration of [{ 'lucide-react': '0.487.0' }, { 'lucide-react-v0487': '^0.487.0' }, { 'react-day-picker': '8.10.1' }, { 'qrcode-generator': '1.4.4' }]) expect(() => projectPackage(declaration)).toThrow();
    expect(() => assertPortableSourcePaths(['src/theme/tokens.ts'])).toThrow();
    expect(() => assertPortableSourcePaths(['src/design-tokens/index.ts'])).toThrow();
    const legacy = JSON.parse(await readFile(path.join(host, 'node_modules/lucide-react/package.json'), 'utf8'));
    const desktop = JSON.parse(await readFile(path.join(host, 'node_modules/lucide-react-v0487/package.json'), 'utf8'));
    expect(legacy.version).toBe('0.468.0'); expect(desktop.version).toBe('0.487.0');
  });

  it('imports, builds and runs the complete first desktop dependency set in live and candidate runtimes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rd-desktop-test-')); directories.push(root);
    const upstream = path.join(root, 'upstream'); await mkdir(path.join(upstream, 'src'), { recursive: true });
    await writeFile(path.join(upstream, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(upstream, 'package.json'), JSON.stringify({ type: 'module', dependencies }));
    const main = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {Box as LegacyIcon} from 'lucide-react';
import {Box as DesktopIcon} from 'lucide-react-v0487';
import * as Menu from '@radix-ui/react-context-menu';
import clsx from 'clsx';import {twMerge} from 'tailwind-merge';
import qrcode from 'qrcode-generator';
import {motion as Framer} from 'framer-motion';import {motion as Motion} from 'motion/react';
import {BarChart,Bar,XAxis,YAxis} from 'recharts';import {Toaster,toast} from 'sonner';
import {Terminal} from 'xterm';import {FitAddon} from 'xterm-addon-fit';import {WebLinksAddon} from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
const qr=qrcode(0,'L');qr.addData('R-Design synthetic dependency fixture');qr.make();
function App(){React.useEffect(()=>{const terminal=new Terminal({cols:30,rows:3});const fit=new FitAddon();terminal.loadAddon(fit);terminal.loadAddon(new WebLinksAddon());terminal.open(document.getElementById('terminal')!);fit.fit();terminal.write('terminal fixture',()=>{(window as any).__desktopTerminal=terminal.buffer.active.getLine(0)?.translateToString(true)});return()=>terminal.dispose()},[]);return <main>
<h1 data-rdesign-id="desktop-title">Desktop packages</h1><LegacyIcon data-testid="legacy-icon"/><DesktopIcon data-testid="desktop-icon"/>
<Menu.Root><Menu.Trigger data-rdesign-id="context-trigger" className={twMerge(clsx('p-1',true&&'p-2'))}>Context surface</Menu.Trigger><Menu.Portal><Menu.Content><Menu.Item onSelect={()=>toast('Context selected')}>Choose context</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>
<div id="qr" dangerouslySetInnerHTML={{__html:qr.createSvgTag()}}/><Framer.div initial={false}>Framer ready</Framer.div><Motion.div initial={false}>Motion ready</Motion.div>
<BarChart width={320} height={160} data={[{name:'fixture',value:7}]}><XAxis dataKey="name"/><YAxis/><Bar dataKey="value" isAnimationActive={false}/></BarChart>
<Toaster/><div id="terminal" style={{width:320,height:100}}/></main>}
createRoot(document.getElementById('root')!).render(<App/>);`;
    await writeFile(path.join(upstream, 'src/main.tsx'), main);
    await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
    await run('git', ['-C', upstream, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic desktop source']);
    const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
    const bundle = await generateEngineeringBundle({ repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/desktop', commit, frontendDirectory: '.', name: 'Desktop fixture', limitations: ['Synthetic browser source only'], scenarios: [{ id: 'desktop', name: 'Desktop', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="desktop-title"]', steps: [], dependencies: ['src/main.tsx'], status: 'unverified' }] });
    const seed = await new DocumentStore(path.join(root, 'seed')).load('test');
    const catalog = await new ProjectWorkspace(path.join(root, 'catalog'), upstream, host).load(seed.project);
    const imported = await catalog.import(bundle), source = await catalog.validate(imported.id);
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory));
    const runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start();
      await runtime.page.waitForFunction(() => (window as any).__desktopTerminal === 'terminal fixture');
      expect(await runtime.page.locator('#qr svg').count()).toBe(1);
      expect(await runtime.page.locator('[data-testid$="icon"]').count()).toBe(2);
      expect(await runtime.page.locator('.recharts-bar').count()).toBe(1);
      await runtime.page.locator('[data-rdesign-id="context-trigger"]').click({ button: 'right' });
      await runtime.page.getByRole('menuitem', { name: 'Choose context' }).click();
      await runtime.page.getByText('Context selected', { exact: true }).waitFor();
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'desktop-title')!;
      expect(target.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, host);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Dependency candidate check', properties: { text: 'Desktop checked' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified');
      await engine.apply(change.id, change.diffHash); await runtime.capture(); expect(await runtime.page.locator('h1').textContent()).toBe('Desktop checked');
      await engine.revert(change.id); await runtime.capture(); expect(await runtime.page.locator('h1').textContent()).toBe('Desktop packages');
    } finally { await runtime.close(); }
  }, 60000);
});
