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
import { codeHash } from '../../packages/source-binding/src/index';
import { ChangeEngine } from '../../packages/change-engine/src/index';

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

async function commitFixture(root: string, files: string[]) {
  await run('git', ['-C', root, 'add', '--', ...files]);
  await run('git', ['-C', root, '-c', 'user.name=Engineering Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture update']);
  return (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
}

describe('committed frontend engineering', () => {
  it('exports only controlled runtime dependency metadata and never original authenticated URL specs', async () => {
    const { root, config } = await sourceFixture();
    const original = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const syntheticMarker = 'SYNTHETIC_CREDENTIAL_NOT_REAL';
    const specifications = [
      `https://synthetic-user:${syntheticMarker}@registry.example.invalid/tool.tgz`,
      `git+https://synthetic-user:${syntheticMarker}@example.invalid/tool.git`,
      `git+ssh://synthetic-user:${syntheticMarker}@example.invalid/tool.git`,
    ];
    original.dependencies.vite = specifications[0];
    original.devDependencies = { 'unused-private-tool': specifications[1] };
    original.optionalDependencies = { 'unused-optional-tool': specifications[2] };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(original));
    config.commit = await commitFixture(root, ['package.json']);
    const bundle = await generateEngineeringBundle(config);
    expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const serialized = JSON.stringify(bundle);
    // Boolean assertions avoid displaying even synthetic credential values in failure reports.
    expect(serialized.includes(syntheticMarker)).toBe(false);
    for (const specification of specifications) expect(serialized.includes(specification)).toBe(false);
    expect(serialized.includes('unused-private-tool')).toBe(false);
    expect(serialized.includes('unused-optional-tool')).toBe(false);
    const origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-origin.json')!.content);
    expect(origin).not.toHaveProperty('originalDependencies');
    expect(origin).not.toHaveProperty('originalDependencyDeclarations');
    expect(origin.runtimeDependencies).toEqual(JSON.parse(bundle.sourceFiles.find(file => file.path === 'package.json')!.content).dependencies);
    original.dependencies.three = specifications[1];
    await writeFile(path.join(root, 'package.json'), JSON.stringify(original));
    config.commit = await commitFixture(root, ['package.json']);
    let rejection: any;
    try { await generateEngineeringBundle(config); } catch (error) { rejection = error; }
    expect(rejection?.code).toBe('ENGINEERING_DEPENDENCY');
    expect(String(rejection?.message).includes(syntheticMarker)).toBe(false);
    expect(String(rejection?.message).includes(specifications[1])).toBe(false);
  });

  it('reads the original commit tree and blobs when replacement refs are active', async () => {
    const { root, config } = await sourceFixture();
    const main = await readFile(path.join(root, 'src/main.tsx'), 'utf8');
    await writeFile(path.join(root, 'src/main.tsx'), main.replace('Committed', 'Replacement'));
    const replacement = await commitFixture(root, ['src/main.tsx']);
    await run('git', ['-C', root, 'replace', config.commit, replacement]);
    expect((await run('git', ['-C', root, 'show', `${config.commit}:src/main.tsx`])).stdout).toContain('Replacement');
    const bundle = await generateEngineeringBundle(config);
    expect(bundle.sourceFiles.find(file => file.path === 'src/main.tsx')!.content).toContain('Committed');
    expect(bundle.sourceFiles.find(file => file.path === 'src/main.tsx')!.content).not.toContain('Replacement');
    const origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-origin.json')!.content);
    expect(origin.commit).toBe(config.commit);
    const blob = (await run('git', ['--no-replace-objects', '-C', root, 'rev-parse', `${config.commit}:src/main.tsx`])).stdout.trim();
    expect(origin.sourceFiles.find((file: any) => file.file === 'src/main.tsx').gitBlobSha).toBe(blob);
    expect((await run('git', ['-C', root, 'show', `${config.commit}:src/main.tsx`])).stdout).toContain('Replacement');
    expect(await readFile(path.join(root, 'src/main.tsx'), 'utf8')).toContain('Replacement');
  });

  it('resolves bare local CSS imports and still reports missing stylesheets', async () => {
    const { root, config } = await sourceFixture();
    const style = await readFile(path.join(root, 'src/style.css'), 'utf8');
    await writeFile(path.join(root, 'src/style.css'), style.replace('./macos-tokens.css', 'macos-tokens.css') + ' main{filter:url(#local-filter)}');
    config.commit = await commitFixture(root, ['src/style.css']);
    const bundle = await generateEngineeringBundle(config);
    expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const dataRoot = path.join(root, 'catalog'); const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, root, repoRoot).load(store.project);
    const imported = await catalog.validate((await catalog.import(bundle)).id);
    await new BrowserRuntime(imported.sourceDirectory, repoRoot).build();
    const css = bundle.sourceFiles.find(file => file.path === 'src/style.css')!;
    css.content += '\n@import "missing.css";'; css.sha256 = digest(css.content); resign(bundle);
    expect(preflightEngineeringBundle(bundle)).toMatchObject({ passed: false, errors: expect.arrayContaining([expect.stringContaining('missing.css')]) });
  }, 20000);

  it.each(['optionalDependencies', 'devDependencies'])('retains imported reviewed packages declared in %s without copying build tooling', async group => {
    const { root, config } = await sourceFixture();
    const original = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    delete original.dependencies['lucide-react']; original[group] = { 'lucide-react': '0.468.0', 'unreviewed-unused-tool': '999.0.0' };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(original));
    config.commit = await commitFixture(root, ['package.json']);
    const bundle = await generateEngineeringBundle(config);
    const normalized = JSON.parse(bundle.sourceFiles.find(file => file.path === 'package.json')!.content);
    expect(normalized.dependencies['lucide-react']).toBe('0.468.0');
    expect(JSON.stringify(normalized)).not.toContain('unreviewed-unused-tool'); expect(normalized.scripts).not.toHaveProperty('postinstall');
    const dataRoot = path.join(root, 'catalog'); const store = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, root, repoRoot).load(store.project);
    const imported = await catalog.validate((await catalog.import(bundle)).id);
    await new BrowserRuntime(imported.sourceDirectory, repoRoot).build();
    original[group]['lucide-react'] = '0.487.0'; await writeFile(path.join(root, 'package.json'), JSON.stringify(original));
    config.commit = await commitFixture(root, ['package.json']);
    await expect(generateEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_DEPENDENCY' });
  }, 20000);

  it('guards root assets through real candidate verification, file conflicts, apply and revert', async () => {
    const { root, config } = await sourceFixture();
    const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`;
    await mkdir(path.join(root, 'assets')); await writeFile(path.join(root, 'assets/hero.svg'), svg('blue'));
    await writeFile(path.join(root, 'assets/caption.ts'), 'export const caption = "Original module";');
    await writeFile(path.join(root, 'assets/palette.json'), '{"label":"Original asset"}');
    const main = await readFile(path.join(root, 'src/main.tsx'), 'utf8');
    await writeFile(path.join(root, 'src/main.tsx'), "import hero from '../assets/hero.svg';\nimport { caption } from '../assets/caption';\nimport palette from '../assets/palette.json';\n" + main.replace('<Box/>', '<h1 data-rdesign-id="asset-title">Asset fixture</h1><p>{caption}</p><img data-rdesign-id="hero" src={hero} alt={palette.label}/><Box/>'));
    config.commit = await commitFixture(root, ['assets', 'src/main.tsx']);
    const bundle = await generateEngineeringBundle(config); expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const dataRoot = path.join(root, 'catalog'); const linked = await new DocumentStore(dataRoot).load('test');
    const catalog = await new ProjectWorkspace(dataRoot, root, repoRoot).load(linked.project);
    const imported = await catalog.validate((await catalog.import(bundle)).id);
    const store = await new DocumentStore(imported.dataDirectory).load(await codeHash(imported.sourceDirectory));
    const runtime = new BrowserRuntime(imported.sourceDirectory, repoRoot, 'live', 0, imported.dataDirectory);
    try {
      await runtime.start(); const frame = await runtime.capture();
      expect(await runtime.page.locator('[data-rdesign-id="hero"]').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(32);
      expect(await runtime.page.locator('p').textContent()).toBe('Original module');
      expect(await runtime.page.locator('[data-rdesign-id="hero"]').getAttribute('alt')).toBe('Original asset');
      const node = frame.nodes.find(node => node.sourceNodeId === 'asset-title')!; expect(node.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, repoRoot);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: crypto.randomUUID(), nodeId: node.runtimeNodeId, sourceNodeId: node.sourceNodeId!, version: frame, intent: 'Synthetic asset guard test', properties: { text: 'Verified asset fixture' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified');
      const baselineCandidate = await codeHash(engine.candidateRoot(change.id));
      for (const [file, replacement] of [['hero.svg', svg('red')], ['caption.ts', 'export const caption = "Changed module";'], ['palette.json', '{"label":"Changed asset"}']]) {
        const candidateAsset = path.join(engine.candidateRoot(change.id), 'assets', file);
        const before = await readFile(candidateAsset);
        await writeFile(candidateAsset, replacement); expect(await codeHash(engine.candidateRoot(change.id))).not.toBe(baselineCandidate);
        await expect(engine.candidateUntouched(change)).rejects.toMatchObject({ code: 'CANDIDATE_CHANGED' });
        await expect(engine.apply(change.id, change.diffHash)).rejects.toMatchObject({ code: 'CANDIDATE_CHANGED' });
        await writeFile(candidateAsset, before); await engine.candidateUntouched(change);
        const liveAsset = path.join(imported.sourceDirectory, 'assets', file);
        await writeFile(liveAsset, replacement); expect(await codeHash(imported.sourceDirectory)).not.toBe(change.baseCodeRevision);
        await expect(engine.apply(change.id, change.diffHash)).rejects.toMatchObject({ code: 'SOURCE_CONFLICT' });
        await writeFile(liveAsset, before);
      }
      await engine.apply(change.id, change.diffHash);
      await runtime.capture(); expect(await runtime.page.locator('[data-rdesign-id="asset-title"]').textContent()).toBe('Verified asset fixture');
      await engine.revert(change.id); await runtime.capture();
      expect(await runtime.page.locator('[data-rdesign-id="asset-title"]').textContent()).toBe('Asset fixture'); expect(change.status).toBe('reverted');
    } finally { await runtime.close(); }
  }, 45000);

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
