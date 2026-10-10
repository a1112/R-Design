import { afterEach, describe, expect, it } from 'vitest';
import React, { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace, projectPackage } from '../../packages/project-workspace/src/index';
import { DocumentStore } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(host, 'package.json'));
const { LineChart, Line } = require('recharts');
const { findAllByType } = require('recharts/lib/util/ReactUtils');
const run = promisify(execFile), directories: string[] = [];
const data = [{ name: 'a', value: 1 }, { name: 'b', value: 3 }, { name: 'c', value: 2 }];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('React 19 fragment chart composition', () => {
  it('uses the scoped React 19 element recognizer and renders direct, fragment and nested/array Line children equally in SSR', async () => {
    const declaration = JSON.parse(await readFile(path.join(host, 'package.json'), 'utf8'));
    expect(declaration.overrides).toEqual({ 'recharts@2.15.4': { 'react-is@18.3.1': '19.3.0' } });
    const chartRequire = createRequire(require.resolve('recharts/package.json'));
    expect(chartRequire('react-is/package.json').version).toBe('19.3.0');
    // The other legacy consumer keeps its original recognizer.
    const legacyRequire = createRequire(require.resolve('prop-types/package.json'));
    expect(legacyRequire('react-is/package.json').version).toBe('16.13.1');
    expect(projectPackage({ recharts: '2.15.4' }).dependencies).toMatchObject({ recharts: '2.15.4' });
    const line = createElement(Line, { dataKey: 'value', isAnimationActive: false });
    const fragment = createElement(Fragment, null, line);
    const nested = createElement(Fragment, null, [createElement(Fragment, { key: 'nested' }, line), false, null]);
    for (const children of [line, fragment, nested]) {
      expect(findAllByType(children, Line)).toHaveLength(1);
      const svg = renderToStaticMarkup(createElement(LineChart, { width: 320, height: 180, data }, children));
      expect(svg.match(/recharts-line-curve/g)).toHaveLength(1);
    }
    const multiple = createElement(Fragment, null, [createElement(Line, { key: 'one', dataKey: 'value', isAnimationActive: false }), createElement(Fragment, { key: 'two' }, createElement(Line, { dataKey: 'value', isAnimationActive: false }))]);
    expect(findAllByType(multiple, Line)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(LineChart, { width: 320, height: 180, data }, multiple)).match(/recharts-line-curve/g)).toHaveLength(2);
  });

  it('renders actual fragment curves, axes and nested series in live and candidate browser runtimes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rd-chart-fragment-')); directories.push(root);
    const upstream = path.join(root, 'upstream'); await mkdir(path.join(upstream, 'src'), { recursive: true });
    await writeFile(path.join(upstream, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(upstream, 'package.json'), JSON.stringify({ dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', recharts: '2.15.4' } }));
    await writeFile(path.join(upstream, 'src/main.tsx'), `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';import {LineChart,Line,XAxis,YAxis} from 'recharts';
const data=[{name:'a',value:1},{name:'b',value:3},{name:'c',value:2}];
function App(){const[wrapped,setWrapped]=useState(true);const line=<Line dataKey="value" isAnimationActive={false}/>;return <main>
<h1 data-rdesign-id="chart-title">Fragment chart fixture</h1><button data-rdesign-id="chart-toggle" onClick={()=>setWrapped(!wrapped)}>Toggle fragment</button>
<div data-testid="direct-chart"><LineChart width={320} height={180} data={data}><XAxis dataKey="name"/><YAxis/>{line}</LineChart></div>
<div data-testid="fragment-chart"><LineChart width={320} height={180} data={data}>{wrapped?<React.Fragment><XAxis dataKey="name"/><YAxis/>{line}</React.Fragment>:<React.Fragment><XAxis dataKey="name"/><YAxis/></React.Fragment>}{!wrapped&&line}</LineChart></div>
<div data-testid="nested-chart"><LineChart width={320} height={180} data={data}><React.Fragment><XAxis dataKey="name"/><YAxis/>{[<React.Fragment key="one">{line}</React.Fragment>,false,<Line key="two" dataKey="value" isAnimationActive={false}/>]}</React.Fragment></LineChart></div>
</main>};createRoot(document.getElementById('root')!).render(<App/>);`);
    await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
    await run('git', ['-C', upstream, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic fragment charts']);
    const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
    const bundle = await generateEngineeringBundle({ repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/fragment-charts', commit, frontendDirectory: '.', name: 'Fragment charts', limitations: ['Synthetic chart composition; no real frontend failure asserted'], scenarios: [{ id: 'charts', name: 'Fragment charts', route: '/', viewport: { width: 1200, height: 1000 }, steps: [], readySelector: '[data-rdesign-id="chart-title"]', dependencies: ['src/main.tsx'], status: 'unverified' }] });
    const seed = await new DocumentStore(path.join(root, 'seed')).load('test');
    const catalog = await new ProjectWorkspace(path.join(root, 'catalog'), upstream, host).load(seed.project);
    const imported = await catalog.import(bundle), source = await catalog.validate(imported.id);
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory));
    const runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start();
      const assertCurves = async () => {
        for (const name of ['direct', 'fragment', 'nested']) {
          const chart = runtime.page.getByTestId(name + '-chart');
          await chart.locator('.recharts-line-curve').first().waitFor();
          expect(await chart.locator('.recharts-line-curve').count()).toBe(name === 'nested' ? 2 : 1);
          expect(await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').count()).toBe(3);
          const geometry = await chart.locator('.recharts-line-curve').first().getAttribute('d');
          expect(geometry).toMatch(/^M/); expect(geometry).not.toContain('NaN');
        }
      };
      await assertCurves();
      await runtime.page.locator('[data-rdesign-id="chart-toggle"]').click(); await assertCurves();
      await runtime.page.locator('[data-rdesign-id="chart-toggle"]').click(); await assertCurves();
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'chart-title')!;
      const engine = new ChangeEngine(store, runtime, host);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Verify fragment chart runtime', properties: { text: 'Chart candidate verified' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified');
      await engine.apply(change.id, change.diffHash); await runtime.capture(); await assertCurves();
      expect(await runtime.page.locator('h1').textContent()).toBe('Chart candidate verified');
      await engine.revert(change.id); await runtime.capture(); await assertCurves();
      expect(await runtime.page.locator('h1').textContent()).toBe('Fragment chart fixture');
    } finally { await runtime.close(); }
  }, 60000);
});
