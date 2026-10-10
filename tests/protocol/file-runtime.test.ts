import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace, projectPackage } from '../../packages/project-workspace/src/index';
import { DocumentStore } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile), directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const fileDependencies = {
  '@radix-ui/react-dialog': '1.1.23', '@radix-ui/react-dropdown-menu': '2.1.24',
  '@radix-ui/react-select': '2.3.7', '@radix-ui/react-slot': '1.3.3',
  '@radix-ui/react-tooltip': '1.2.8', 'class-variance-authority': '0.7.1', 'date-fns': '3.6.0',
};

describe('controlled file browser dependencies', () => {
  it('rejects unreviewed versions, ranges and install aliases for every added package', () => {
    expect(projectPackage(fileDependencies).dependencies).toMatchObject(fileDependencies);
    for (const [name, version] of Object.entries(fileDependencies)) {
      for (const unsupported of ['0.0.0', '^' + version, 'npm:' + name + '@' + version]) {
        expect(() => projectPackage({ [name]: unsupported })).toThrow();
      }
    }
  });

  it('imports and builds interactive controls, then verifies, applies and semantically reverts a candidate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rd-file-test-')); directories.push(root);
    const upstream = path.join(root, 'upstream'); await mkdir(path.join(upstream, 'src'), { recursive: true });
    await writeFile(path.join(upstream, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(upstream, 'package.json'), JSON.stringify({ type: 'module', dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', ...fileDependencies } }));
    await writeFile(path.join(upstream, 'src/main.tsx'), `import React from 'react';
import {createRoot} from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Select from '@radix-ui/react-select';import {Slot} from '@radix-ui/react-slot';
import * as Tooltip from '@radix-ui/react-tooltip';import {cva} from 'class-variance-authority';import {format,parseISO} from 'date-fns';
const appearance=cva('file-action',{variants:{tone:{active:'active-tone',quiet:'quiet-tone'}}});
function App(){const [selected,setSelected]=React.useState('name'),[action,setAction]=React.useState('none');return <main>
<h1 data-rdesign-id="file-title">File controls</h1><time data-testid="file-date">{format(parseISO('2026-10-10'),'yyyy-MM-dd')}</time>
<Slot className={appearance({tone:'active'})}><button data-testid="slot-action" onClick={()=>setAction('slot')}>Slotted action</button></Slot><output data-testid="file-action">{action}</output>
<Dialog.Root><Dialog.Trigger data-rdesign-id="dialog-trigger">Open file dialog</Dialog.Trigger><Dialog.Portal><Dialog.Content data-rdesign-id="file-dialog"><Dialog.Title>File details</Dialog.Title><Dialog.Description>Synthetic browser fixture</Dialog.Description><Dialog.Close>Close details</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
<Menu.Root><Menu.Trigger data-rdesign-id="menu-trigger">File actions</Menu.Trigger><Menu.Portal><Menu.Content><Menu.Item onSelect={()=>setAction('renamed')}>Rename fixture</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>
<Select.Root value={selected} onValueChange={setSelected}><Select.Trigger data-rdesign-id="sort-trigger"><Select.Value/></Select.Trigger><Select.Portal><Select.Content><Select.Viewport><Select.Item value="name"><Select.ItemText>Name</Select.ItemText></Select.Item><Select.Item value="date"><Select.ItemText>Date</Select.ItemText></Select.Item></Select.Viewport></Select.Content></Select.Portal></Select.Root><output data-testid="file-sort">{selected}</output>
<Tooltip.Provider delayDuration={0}><Tooltip.Root><Tooltip.Trigger data-rdesign-id="tooltip-trigger">Help</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content>File help fixture</Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>
</main>}
createRoot(document.getElementById('root')!).render(<App/>);`);
    await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
    await run('git', ['-C', upstream, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic file browser source']);
    const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
    const bundle = await generateEngineeringBundle({ repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/file-browser', commit, frontendDirectory: '.', name: 'File controls fixture', limitations: ['Synthetic controls only; no private application source or file service'], scenarios: [
      { id: 'file-main', name: 'Main controls', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="file-title"]', steps: [], dependencies: ['src/main.tsx'], status: 'unverified' },
      { id: 'file-dialog', name: 'Portal dialog', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="file-dialog"]', steps: [{ action: 'click', target: 'dialog-trigger' }], dependencies: ['src/main.tsx'], status: 'unverified' },
    ] });
    const seed = await new DocumentStore(path.join(root, 'seed')).load('test');
    const catalog = await new ProjectWorkspace(path.join(root, 'catalog'), upstream, host).load(seed.project);
    const imported = await catalog.import(bundle), source = await catalog.validate(imported.id);
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory));
    const runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start();
      expect(await runtime.page.getByTestId('file-date').textContent()).toBe('2026-10-10');
      expect(await runtime.page.getByTestId('slot-action').getAttribute('class')).toBe('file-action active-tone');
      await runtime.page.getByTestId('slot-action').click();
      expect(await runtime.page.getByTestId('file-action').textContent()).toBe('slot');
      await runtime.page.getByRole('button', { name: 'Open file dialog' }).click();
      await runtime.page.getByRole('dialog', { name: 'File details' }).waitFor();
      await runtime.page.getByRole('button', { name: 'Close details' }).click();
      await runtime.page.getByRole('button', { name: 'File actions' }).click();
      await runtime.page.getByRole('menuitem', { name: 'Rename fixture' }).click();
      expect(await runtime.page.getByTestId('file-action').textContent()).toBe('renamed');
      await runtime.page.getByRole('combobox').click();
      await runtime.page.getByRole('option', { name: 'Date', exact: true }).click();
      expect(await runtime.page.getByTestId('file-sort').textContent()).toBe('date');
      await runtime.page.getByRole('button', { name: 'Help', exact: true }).hover();
      await runtime.page.getByRole('tooltip').waitFor();
      expect(await runtime.page.getByRole('tooltip').textContent()).toBe('File help fixture');
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'file-title')!;
      expect(target.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, host);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'File controls candidate check', properties: { text: 'File controls checked' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified');
      expect(change.evidence.filter(evidence => evidence.name.includes('Main controls') || evidence.name.includes('Portal dialog'))).toHaveLength(2);
      expect(change.evidence.every(evidence => evidence.passed)).toBe(true);
      await engine.apply(change.id, change.diffHash); await runtime.capture();
      expect(await runtime.page.locator('h1').textContent()).toBe('File controls checked');
      await engine.revert(change.id); await runtime.capture();
      expect(await runtime.page.locator('h1').textContent()).toBe('File controls');
    } finally { await runtime.close(); }
  }, 60000);
});
