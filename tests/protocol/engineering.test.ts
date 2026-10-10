import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateEngineeringBundle, preflightEngineeringBundle, type EngineeringConfig } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace, validatePortableProjectBundle } from '../../packages/project-workspace/src/index';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';

const run = promisify(execFile), directories: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, '../..');
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEIoAAAAASUVORK5CYII=', 'base64');

async function sourceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-engineering-test-')); directories.push(root);
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.3.0', 'react-dom': '19.3.0', 'lucide-react': '0.468.0', three: '0.180.0', '@tauri-apps/api': '2.8.0' }, scripts: { postinstall: 'exit 99', build: 'exit 99' } }));
  await writeFile(path.join(root, 'src/main.tsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box } from 'lucide-react';
import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isTauri } from '@tauri-apps/api/core';
import './style.css';
createRoot(document.getElementById('root')!).render(<main data-rdesign-id="view"><Box/>Committed {new Vector3(3,0,0).length()} {typeof OrbitControls} {String(isTauri())}</main>);`);
  await writeFile(path.join(root, 'src/style.css'), '@import "./macos-tokens.css"; main{background-image:url("/demo.png")}');
  await writeFile(path.join(root, 'src/macos-tokens.css'), ':root{--surface:#fff}');
  await writeFile(path.join(root, 'src/access-tokens.json'), '{"value":"PRIVATE_TOKEN_DATA_DO_NOT_EXPORT"}');
  await writeFile(path.join(root, 'public/demo.png'), png);
  await writeFile(path.join(root, '.env'), 'IGNORED_PRIVATE_DATA=not-for-delivery');
  await run('git', ['init', root]); await run('git', ['-C', root, 'add', '.']);
  await run('git', ['-C', root, '-c', 'user.name=Engineering Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const commit = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  const config: EngineeringConfig = { repositoryRoot: root, repositoryUrl: 'https://github.com/example/frontend', commit, frontendDirectory: '.', name: 'Committed frontend', limitations: ['Synthetic test fixture'],
    relocations: [{ from: 'public/demo.png', to: 'src/assets/demo.png' }], edits: [{ file: 'src/style.css', find: '/demo.png', replace: './assets/demo.png' }],
    scenarios: [{ id: 'desktop', name: 'Desktop', route: '/', viewport: { width: 1200, height: 820 }, steps: [], readySelector: '[data-rdesign-id="view"]', dependencies: ['src/main.tsx'], status: 'unverified' },
      { id: 'narrow', name: 'Narrow', route: '/', viewport: { width: 390, height: 844 }, steps: [], readySelector: '[data-rdesign-id="view"]', dependencies: ['src/main.tsx'], status: 'unverified' }] };
  return { root, config };
}

function resign(bundle: Awaited<ReturnType<typeof generateEngineeringBundle>>) { const { checksum: _checksum, ...payload } = bundle; bundle.checksum = digest(JSON.stringify(payload)); return bundle; }

describe('committed frontend engineering', () => {
  it('keeps dirty source untouched, includes binary resources and records all explicit adaptations', async () => {
    const { root, config } = await sourceFixture();
    await writeFile(path.join(root, 'src/main.tsx'), 'local changes to preserve');
    const bundle = await generateEngineeringBundle(config);
    validatePortableProjectBundle(bundle);
    expect(preflightEngineeringBundle(bundle)).toMatchObject({ passed: true, errors: [], scenarioCount: 2 });
    expect(await readFile(path.join(root, 'src/main.tsx'), 'utf8')).toBe('local changes to preserve');
    expect(JSON.stringify(bundle)).not.toContain('IGNORED_PRIVATE_DATA');
    expect(JSON.stringify(bundle)).not.toContain('PRIVATE_TOKEN_DATA_DO_NOT_EXPORT');
    expect(bundle.sourceFiles.some(file => file.path === 'src/macos-tokens.css')).toBe(true);
    expect(bundle.sourceFiles.find(file => file.path === 'src/main.tsx')?.content).toContain('Committed');
    const image = bundle.sourceFiles.find(file => file.path === 'src/assets/demo.png')!;
    expect(image.encoding).toBe('base64'); expect(Buffer.from(image.content, 'base64')).toEqual(png);
    const origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-origin.json')!.content);
    expect(origin.commit).toBe(config.commit); expect(origin.adaptations.map((item: any) => item.file)).toEqual(['package.json', 'src/style.css', 'src/main.tsx']);
    expect(JSON.parse(bundle.sourceFiles.find(file => file.path === 'package.json')!.content).scripts).toEqual({ dev: 'vite --host 127.0.0.1', build: 'vite build' });
  });

  it('imports reviewed dependency versions, isolates identity, and builds without project node_modules', async () => {
    const { root, config } = await sourceFixture(); const bundle = await generateEngineeringBundle(config);
    const dataRoot = path.join(root, 'catalog'); const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, root, repoRoot).load(store.project);
    const summary = await catalog.import(bundle); const imported = await catalog.validate(summary.id);
    expect(summary.id).not.toBe(bundle.manifest.id);
    const packageJson = JSON.parse(await readFile(path.join(imported.sourceDirectory, 'package.json'), 'utf8'));
    expect(packageJson.dependencies).toMatchObject({ three: '0.180.0', 'lucide-react': '0.468.0', '@tauri-apps/api': '2.8.0' });
    const runtime = new BrowserRuntime(imported.sourceDirectory, repoRoot);
    const environment = process.env.NODE_ENV;
    try {
      await runtime.build();
      expect((await readFile(path.join(imported.sourceDirectory, 'dist/index.html'), 'utf8'))).toContain('/assets/');
      // A preceding build or production host must not disable the controlled preview's SDK.
      process.env.NODE_ENV = 'production';
      await runtime.start();
      expect(runtime.port).toBeGreaterThan(0); expect(runtime.port).not.toBe(5173);
      const frame = await runtime.capture();
      expect(frame.nodes.find(node => node.sourceNodeId === 'view')).toMatchObject({ binding: { reliability: 'exact', file: 'src/main.tsx' } });
      expect(await runtime.page.locator('[data-rdesign-id="view"]').textContent()).toContain('Committed');
    } finally {
      await runtime.close();
      if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
    }
  }, 45000);

  it('detects a missing relative import even with valid hashes, and rejects tampered bytes', async () => {
    const { config } = await sourceFixture(); const bundle = await generateEngineeringBundle(config);
    const main = bundle.sourceFiles.find(file => file.path === 'src/main.tsx')!;
    main.content += '\nimport "./missing-resource.css";'; main.sha256 = digest(main.content); resign(bundle);
    expect(preflightEngineeringBundle(bundle)).toMatchObject({ passed: false, errors: expect.arrayContaining([expect.stringContaining('missing-resource.css')]) });
    main.content += '//tampered';
    expect(() => preflightEngineeringBundle(resign(bundle))).toThrow('工程源文件校验失败');
  });

  it.each(['^0.180.0', 'https://example.invalid/three.tgz', '0.181.0'])('rejects an unreviewed dependency version %s before allocating a project', async version => {
    const { root, config } = await sourceFixture(); const bundle = await generateEngineeringBundle(config);
    const packageFile = bundle.sourceFiles.find(file => file.path === 'package.json')!;
    const incoming = JSON.parse(packageFile.content); incoming.dependencies.three = version;
    packageFile.content = JSON.stringify(incoming); packageFile.sha256 = digest(packageFile.content); resign(bundle);
    const dataRoot = path.join(root, 'catalog'); const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, root, repoRoot).load(store.project);
    await expect(catalog.import(bundle)).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
    expect(catalog.catalog.projects).toHaveLength(1);
    await expect(readFile(path.join(dataRoot, 'projects'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses stale edit anchors, unrelocated public assets and explicit private copy rules', async () => {
    const { config } = await sourceFixture();
    await expect(generateEngineeringBundle({ ...config, edits: [{ file: 'src/style.css', find: 'missing anchor', replace: 'x' }] })).rejects.toMatchObject({ code: 'ENGINEERING_EDIT' });
    await expect(generateEngineeringBundle({ ...config, relocations: [] })).rejects.toMatchObject({ code: 'ENGINEERING_PREFLIGHT' });
    await expect(generateEngineeringBundle({ ...config, copies: [{ from: '.env', to: 'src/data.json' }] })).rejects.toMatchObject({ code: 'ENGINEERING_SOURCE' });
  });

  it('does not read tracked application symlink targets', async () => {
    const { root, config } = await sourceFixture();
    await symlink('/outside/private.txt', path.join(root, 'src/linked.txt'));
    await run('git', ['-C', root, 'add', 'src/linked.txt']);
    await run('git', ['-C', root, '-c', 'user.name=Engineering Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'symlink']);
    config.commit = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await expect(generateEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_SOURCE' });
  });
});
