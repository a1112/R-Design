import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packPreparedEngineeringBundle, type PreparedEngineeringConfig } from '../../packages/project-workspace/src/prepared-engineering';
import { preflightEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace } from '../../packages/project-workspace/src/index';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';

const run = promisify(execFile), directories: string[] = [], host = path.resolve(import.meta.dirname, '../..');
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-prepared-test-')); directories.push(root);
  const original = path.join(root, 'original'), prepared = path.join(root, 'prepared');
  await mkdir(path.join(original, 'src'), { recursive: true }); await mkdir(path.join(prepared, 'src/rdesign-preview'), { recursive: true });
  const upstream = "import React from 'react';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')!).render(<h1 data-rdesign-id=\"prepared-title\">Original frontend</h1>);";
  const adapted = "import {installRuntime} from '@rdesign/runtime-web';\n" + upstream.replace('Original frontend', 'Prepared frontend') + '\ninstallRuntime();';
  await writeFile(path.join(original, 'src/main.tsx'), upstream);
  const resource = Buffer.alloc(1024 * 1024 + 7, 45); await writeFile(path.join(original, 'large.png'), resource);
  await run('git', ['init', original]); await run('git', ['-C', original, 'add', '.']);
  await run('git', ['-C', original, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic source']);
  const commit = (await run('git', ['-C', original, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(path.join(prepared, 'src/main.tsx'), adapted);
  const chunks: string[] = [];
  for (let offset = 0; offset < resource.length; offset += 512 * 1024) { const name = 'src/rdesign-preview/resource-' + chunks.length + '.json'; chunks.push(name); await writeFile(path.join(prepared, name), JSON.stringify({ base64: resource.subarray(offset, offset + 512 * 1024).toString('base64') })); }
  const ledger = { schemaVersion: 1, source: { repository: 'example/frontend', commit }, stagedFiles: [{ sourcePath: 'src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(upstream), sha256: digest(adapted) }], splitResources: [{ file: 'large.png', bytes: resource.length, sha256: digest(resource), chunks }] };
  await writeFile(path.join(prepared, 'src/rdesign-preview/provenance.json'), JSON.stringify(ledger));
  await writeFile(path.join(prepared, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await writeFile(path.join(prepared, 'package.json'), JSON.stringify({ type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, dependencies: { '@rdesign/runtime-web': '*', react: '^19.1.0', 'react-dom': '^19.1.0' } }));
  const config: PreparedEngineeringConfig = { preparedDirectory: prepared, repositoryRoot: original, repositoryUrl: 'https://github.com/example/frontend', commit, provenanceFile: 'src/rdesign-preview/provenance.json', name: 'Prepared fixture', limitations: ['Synthetic adaptation; no backend'], scenarios: [{ id: 'desktop', name: 'Desktop', route: '/', viewport: { width: 1200, height: 820 }, steps: [], readySelector: '[data-rdesign-id="prepared-title"]', dependencies: ['src/main.tsx'], status: 'unverified' }, { id: 'narrow', name: 'Narrow', route: '/', viewport: { width: 390, height: 844 }, steps: [], readySelector: '[data-rdesign-id="prepared-title"]', dependencies: ['src/main.tsx'], status: 'unverified' }] };
  return { root, original, prepared, config, ledger, adapted };
}

describe('explicit prepared-source engineering', () => {
  it('verifies original and adapted bytes plus lossless chunks, imports and renders without changing input', async () => {
    const { root, prepared, original, config, adapted } = await fixture();
    await writeFile(path.join(original, 'src/main.tsx'), 'dirty bytes to preserve');
    const bundle = await packPreparedEngineeringBundle(config);
    expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-prepared-origin.json')!.content);
    expect(origin.kind).toBe('prepared-source'); expect(origin.commit).toBe(config.commit);
    expect(await readFile(path.join(original, 'src/main.tsx'), 'utf8')).toBe('dirty bytes to preserve');
    expect(await readFile(path.join(prepared, 'src/main.tsx'), 'utf8')).toBe(adapted);
    const dataRoot = path.join(root, 'catalog'); const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, prepared, host).load(store.project);
    const imported = await catalog.validate((await catalog.import(bundle)).id); expect(imported.manifest.id).not.toBe(bundle.manifest.id);
    const runtime = new BrowserRuntime(imported.sourceDirectory, host);
    try { await runtime.build(); await runtime.start(); const frame = await runtime.capture(); expect(frame.nodes.find(node => node.sourceNodeId === 'prepared-title')?.binding?.reliability).toBe('exact'); expect(await runtime.page.locator('h1').textContent()).toBe('Prepared frontend'); }
    finally { await runtime.close(); }
  }, 30000);

  it('rejects false source hashes, staged changes, damaged chunks and mismatched origin identities', async () => {
    const { prepared, config, ledger, adapted } = await fixture(); const record = path.join(prepared, config.provenanceFile);
    const expected = ledger.stagedFiles[0].sourceSha256; ledger.stagedFiles[0].sourceSha256 = '0'.repeat(64); await writeFile(record, JSON.stringify(ledger));
    await expect(packPreparedEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
    ledger.stagedFiles[0].sourceSha256 = expected; await writeFile(record, JSON.stringify(ledger));
    await writeFile(path.join(prepared, 'src/main.tsx'), adapted + '// tampered');
    await expect(packPreparedEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
    await writeFile(path.join(prepared, 'src/main.tsx'), adapted);
    await writeFile(path.join(prepared, ledger.splitResources[0].chunks[0]), '{"base64":"YWJj"}');
    await expect(packPreparedEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
    await expect(packPreparedEngineeringBundle({ ...config, repositoryUrl: 'https://github.com/example/other' })).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
  });

  it('builds and executes the registered Markdown, translation, router, plot and Zod v4 packages through the real host', async () => {
    const { root, prepared, config, ledger } = await fixture();
    const main = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {installRuntime} from '@rdesign/runtime-web';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import i18next from 'i18next';
import {I18nextProvider,useTranslation} from 'react-i18next';
import {MemoryRouter,Link} from 'react-router-dom';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {z} from 'zod/v4';
function App(){const {t}=useTranslation();return <><h1 data-rdesign-id="prepared-title">{t('ready')}</h1><Markdown remarkPlugins={[remarkGfm]}>{'~~Original~~'}</Markdown><Link to="/checked">Zod {z.number().parse(7)}</Link><div id="plot"/></>}
await i18next.init({lng:'en',resources:{en:{translation:{ready:'Registered runtime'}}}});
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18next}><MemoryRouter><App/></MemoryRouter></I18nextProvider>);
installRuntime();
setTimeout(()=>new uPlot({width:320,height:160,series:[{},{}]},[[0,1],[1,2]],document.getElementById('plot')!),100);
`;
    await writeFile(path.join(prepared, 'src/main.tsx'), main);
    ledger.stagedFiles[0].sha256 = digest(main);
    await writeFile(path.join(prepared, config.provenanceFile), JSON.stringify(ledger));
    const packageFile = path.join(prepared, 'package.json'), declaration = JSON.parse(await readFile(packageFile, 'utf8'));
    Object.assign(declaration.dependencies, { 'react-markdown': '9.0.3', 'remark-gfm': '4.0.1', i18next: '25.10.0', 'react-i18next': '16.3.5', 'react-router-dom': '7.9.3', uplot: '1.6.32', zod: '3.25.76' });
    await writeFile(packageFile, JSON.stringify(declaration));
    const bundle = await packPreparedEngineeringBundle(config), dataRoot = path.join(root, 'registered-catalog');
    const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, prepared, host).load(store.project);
    const imported = await catalog.validate((await catalog.import(bundle)).id);
    const runtime = new BrowserRuntime(imported.sourceDirectory, host);
    try {
      await runtime.build(); await runtime.start(); await runtime.page.locator('#plot canvas').first().waitFor();
      expect(await runtime.page.locator('h1').textContent()).toBe('Registered runtime');
      expect(await runtime.page.locator('del').textContent()).toBe('Original');
      expect(await runtime.page.locator('a').textContent()).toBe('Zod 7');
      const frame = await runtime.capture(); expect(frame.nodes.find(node => node.sourceNodeId === 'prepared-title')?.binding?.reliability).toBe('exact');
    } finally { await runtime.close(); }
  }, 30000);
});
