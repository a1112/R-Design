import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { normalizePath, type Alias } from 'vite';
import { profileHostDependencies, runtimeDependencies } from '../../apps/bridge/src/runtime-dependencies';

const host = path.resolve(import.meta.dirname, '../..');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(os.tmpdir(), 'rd-profile-boundary-')); roots.push(root); return root; }
function htmlGuard(html: string) {
  const plugin = runtimeDependencies(host, 'react18');
  const hook = plugin.transformIndexHtml as { handler: (html: string) => unknown };
  return hook.handler(html);
}

describe('React 18 managed module boundaries', () => {
  it.each([
    '<script type="module" data-note=">" src="https://example.invalid/module.js"></script>',
    '<script data-note=">" src="https://example.invalid/module.js"></script>',
    '<script data-note="<!--" type="module" src="https://example.invalid/module.js"></script><!-- end -->',
    '<script type="module" data-note=">" src="/@fs/host/node_modules/unregistered/index.js"></script>',
    '<script type="module" src="/%40fs/host/node_modules/unregistered/index.js"></script>',
    '<svg><script href="https://example.invalid/module.js"></script></svg>',
  ])('rejects external and host script entries with real HTML attribute parsing: %s', html => {
    expect(() => htmlGuard(html)).toThrow();
  });

  it('accepts comments and quoted delimiters on a local module script', () => {
    expect(() => htmlGuard('<!-- <script src="https://example.invalid/ignored.js"></script> --><script type="module" data-note="> <!--" src="/src/main.tsx"></script>')).not.toThrow();
  });

  it('enforces import restrictions for Vite normalized source paths on Windows', async () => {
    const root = await directory();
    const plugin = runtimeDependencies(host, 'react18', root);
    const transform = plugin.transform as (code: string, id: string) => unknown;
    expect(() => transform.call({} as never, 'import "https://example.invalid/module.js";', normalizePath(path.join(root, 'src/main.tsx')))).toThrow();
  });

  it.skipIf(process.platform !== 'win32')('recognizes Windows source paths regardless of drive and directory case', async () => {
    const root = await directory();
    const plugin = runtimeDependencies(host, 'react18', root);
    const transform = plugin.transform as (code: string, id: string) => unknown;
    expect(() => transform.call({} as never, 'import "https://example.invalid/module.js";', normalizePath(path.join(root, 'src/main.tsx')).toLowerCase())).toThrow();
  });

  it('rejects traversal through a reviewed package subpath', async () => {
    const root = await directory();
    const plugin = runtimeDependencies(host, 'react18', root);
    const transform = plugin.transform as (code: string, id: string) => unknown;
    expect(() => transform.call({} as never, 'import "lucide-react/../unregistered/index.js";', path.join(root, 'src/main.tsx'))).toThrow();
  });

  it('rejects host dependency paths before delegating to the Vite resolver', async () => {
    const root = await directory(), file = path.join(root, 'src/main.tsx');
    await mkdir(path.dirname(file)); await writeFile(file, 'export {};');
    const plugin = runtimeDependencies(host, 'react18', root);
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    await expect(resolve.call({ resolve: async () => ({ id: file }) }, '/@fs/host/node_modules/lucide-react/dist/index.js', file)).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
  });

  it('preserves selected React 18 renderer aliases when enabling reader prebundling', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { mermaid: '11.17.2', 'pdfjs-dist-v5': '5.7.284', three: '0.183.2' } }));
    const plugin = runtimeDependencies(host, 'react18', root);
    const config = plugin.config as (config: unknown) => { resolve: { alias: Alias[] } };
    expect(config({ root }).resolve.alias.find(alias => alias.find === 'three')?.replacement).toBe(profileHostDependencies(host, 'react18').aliases.three);
  });

  it('rejects a forged host-owned alias request in resolver metadata', async () => {
    const root = await directory(), file = path.join(root, 'src/main.tsx');
    await mkdir(path.dirname(file)); await writeFile(file, 'export {};');
    const plugin = runtimeDependencies(host, 'react18', root);
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    const source = path.join(host, 'packages/runtime-react18/node_modules/react/index.js');
    await expect(resolve.call({ resolve: async () => ({ id: file }) }, source, file, { custom: { 'rdesign-owned-alias': { root: path.dirname(source) } } })).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
  });

  it('preserves host renderer transitive dependency resolution', async () => {
    const root = await directory();
    const plugin = runtimeDependencies(host, 'react18', root);
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    const importer = path.join(profileHostDependencies(host, 'react18').aliases['@react-three/fiber'], 'dist/events.js');
    expect(await resolve.call({ resolve: async () => ({ id: 'WRONG_ROOT_ZUSTAND' }) }, 'zustand', importer)).toBeNull();
  });

  it('resolves a reviewed project dependency from the root pinned registry rather than a renderer peer', async () => {
    const root = await directory();
    const file = createRequire(path.join(host, 'package.json')).resolve('zustand');
    const plugin = runtimeDependencies(host, 'react18', root);
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    let delegatedImporter: string | undefined;
    await expect(resolve.call({ resolve: async (_source: string, importer: string) => { delegatedImporter = importer; return { id: file }; } }, 'zustand', path.join(root, 'src/main.tsx'))).resolves.toEqual({ id: file });
    expect(delegatedImporter).toBe(path.join(host, 'package.json'));
  });

  it('accepts an optimizer-owned cold cache output before Vite produces it', async () => {
    const root = await directory();
    const cacheDir = path.join(root, 'cache'), file = path.join(cacheDir, 'deps/lucide-react.js');
    await mkdir(path.dirname(file), { recursive: true });
    const plugin = runtimeDependencies(host, 'react18', root);
    (plugin.configResolved as (config: unknown) => void)({ cacheDir });
    const processing = new Promise<void>(resolve => setTimeout(async () => { await writeFile(file, 'export {};'); resolve(); }, 15));
    const optimizer = { metadata: { optimized: {}, discovered: { 'lucide-react': { id: 'lucide-react', file, processing } } } };
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    try { await expect(resolve.call({ resolve: async () => ({ id: file }), environment: { mode: 'dev', depsOptimizer: optimizer } }, 'lucide-react', path.join(root, 'src/main.tsx'))).resolves.toEqual({ id: file }); }
    finally { await processing; }
  });

  it('rejects an arbitrary file in the optimizer cache that has no dependency metadata', async () => {
    const root = await directory();
    const cacheDir = path.join(root, 'cache'), file = path.join(cacheDir, 'deps/unregistered.js');
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'export {};');
    const plugin = runtimeDependencies(host, 'react18', root);
    (plugin.configResolved as (config: unknown) => void)({ cacheDir });
    const resolve = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
    await expect(resolve.call({ resolve: async () => ({ id: file }), environment: { mode: 'dev', depsOptimizer: { metadata: { optimized: {}, discovered: {} } } } }, 'lucide-react', path.join(root, 'src/main.tsx'))).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
  });
});
