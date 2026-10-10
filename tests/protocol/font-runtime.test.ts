import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { packPreparedEngineeringBundle, type PreparedEngineeringConfig } from '../../packages/project-workspace/src/prepared-engineering';
import { proveThemeStyleModule } from '../../packages/project-workspace/src/theme-style-proof';
import { preflightEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { ProjectWorkspace, projectPackage, readPortableSourceFiles, validatePortableProjectBundle } from '../../packages/project-workspace/src/index';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';
import { codeHash } from '../../packages/source-binding/src/index';

const host = path.resolve(import.meta.dirname, '../..'), run = promisify(execFile), directories: string[] = [];
const versions = { 'react-dnd': '16.0.1', 'react-dnd-html5-backend': '16.0.1', 'react-syntax-highlighter': '16.1.2' };
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
// Synthetic color module, not a copy of an application source file.
const style = `import { getThemePresetById } from './registry';
import type { AppearanceSettings, ResolvedTheme, ThemePresetId, ThemeTokens } from './types';
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const isHexColor = (value: string) => /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value);
export const buildThemeTokens = (presetId: ThemePresetId, resolvedTheme: ResolvedTheme, appearanceSettings: AppearanceSettings): ThemeTokens => {
  const preset = getThemePresetById(presetId);
  const surface = resolvedTheme === 'dark' ? preset.dark : preset.light;
  return { background: surface.background, primary: appearanceSettings.accentColor || preset.accentColor };
};
export const applyThemeToDOM = (theme: ResolvedTheme, tokens: ThemeTokens, appearanceSettings: AppearanceSettings) => {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.setAttribute('data-theme', theme);
  const entries: Array<[string, string]> = [['--background', tokens.background], ['--primary', tokens.primary], ['--radius-scale', appearanceSettings.radiusScale.toFixed(2)]];
  entries.forEach(([key, value]) => root.style.setProperty(key, value));
};`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-font-proof-')); directories.push(root);
  const upstream = path.join(root, 'upstream'), prepared = path.join(root, 'prepared');
  await mkdir(path.join(upstream, 'web/src/theme'), { recursive: true }); await mkdir(path.join(prepared, 'src/theme'), { recursive: true });
  const registry = "export const getThemePresetById = (_id: string) => ({light:{background:'#ffffff'},dark:{background:'#111827'},accentColor:'#2563eb'});";
  const types = "export type ResolvedTheme='light'|'dark';export type ThemePresetId=string;export interface AppearanceSettings{accentColor:string;radiusScale:number}export interface ThemeTokens{background:string;primary:string}";
  const main = `import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {DndProvider,useDrag,useDrop} from 'react-dnd';import {HTML5Backend} from 'react-dnd-html5-backend';
import {PrismLight as Highlighter} from 'react-syntax-highlighter';import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';import {oneDark} from 'react-syntax-highlighter/dist/esm/styles/prism';
import {buildThemeTokens,applyThemeToDOM} from './theme/design-style';
Highlighter.registerLanguage('javascript',javascript);
function Card(){const[,drag]=useDrag(()=>({type:'sample',item:{id:'synthetic'}}));return <button data-testid="drag" ref={element=>{drag(element)}}>Drag synthetic card</button>}
function App(){const[mode,setMode]=useState<'light'|'dark'>('light'),[result,setResult]=useState('waiting');const[,drop]=useDrop(()=>({accept:'sample',drop:()=>{setResult('dropped')}}));useEffect(()=>{const appearance={accentColor:'#2563eb',radiusScale:1};applyThemeToDOM(mode,buildThemeTokens('paper',mode,appearance),appearance)},[mode]);return <main style={{padding:20}}><h1 data-rdesign-id="font-fixture-title" style={{background:'#dbeafe'}}>Synthetic font controls</h1><Card/><section data-testid="drop" ref={element=>{drop(element)}} style={{padding:32,border:'1px solid #64748b'}}>Drop target</section><output data-testid="drop-result">{result}</output><button data-rdesign-id="font-fixture-theme" onClick={()=>setMode(value=>value==='light'?'dark':'light')}>Change theme</button><Highlighter language="javascript" style={oneDark}>{'const answer = 42;'}</Highlighter></main>}
createRoot(document.getElementById('root')!).render(<DndProvider backend={HTML5Backend}><App/></DndProvider>);`;
  const originalMain = main.replace('./theme/design-style', './theme/tokens');
  const adapted = "import {installRuntime} from '@rdesign/runtime-web';\n" + main + '\ninstallRuntime();';
  const files = { 'web/src/main.tsx': originalMain, 'web/src/theme/tokens.ts': style, 'web/src/theme/registry.ts': registry, 'web/src/theme/types.ts': types, 'web/package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', ...versions } }) };
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(upstream, file), content);
  await run('git', ['init', upstream]);
  async function commit() { await run('git', ['-C', upstream, 'add', '.']); await run('git', ['-C', upstream, '-c', 'user.name=Style Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic style fixture']); return (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim(); }
  const sourceCommit = await commit();
  const ledger: any = { schemaVersion: 1, source: { repository: 'example/style-frontend', commit: sourceCommit }, stagedFiles: [
    { sourcePath: 'web/src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(originalMain), sha256: digest(adapted) },
    { sourcePath: 'web/src/theme/tokens.ts', path: 'src/theme/design-style.ts', sourceSha256: digest(style), sha256: digest(style), sourceRole: 'theme-style-module' },
    ...[['registry.ts', registry], ['types.ts', types]].map(([file, content]) => ({ sourcePath: 'web/src/theme/' + file, path: 'src/theme/' + file, sourceSha256: digest(content), sha256: digest(content) }))
  ], splitResources: [] };
  for (const [file, content] of Object.entries({ 'src/main.tsx': adapted, 'src/theme/design-style.ts': style, 'src/theme/registry.ts': registry, 'src/theme/types.ts': types, 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'package.json': JSON.stringify(projectPackage(versions)) })) await writeFile(path.join(prepared, file), content);
  const provenanceFile = 'src/style-provenance.json';
  const save = () => writeFile(path.join(prepared, provenanceFile), JSON.stringify(ledger)); await save();
  const config: PreparedEngineeringConfig = { repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/style-frontend', commit: sourceCommit, name: 'Synthetic font compatibility', preparedDirectory: prepared, provenanceFile, themeStyleModule: { frontendDirectory: 'web', sourceSha256: digest(style) }, limitations: ['Synthetic DnD/Prism/colors only; no actual fonts, authentication or native/backend success'], scenarios: [
    { id: 'main', name: 'Main', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="font-fixture-title"]', steps: [], dependencies: ['src/main.tsx'], status: 'unverified' },
    { id: 'dark-narrow', name: 'Dark narrow', route: '/', viewport: { width: 390, height: 844 }, readySelector: 'html[data-theme="dark"]', steps: [{ action: 'click', target: 'font-fixture-theme' }], dependencies: ['src/main.tsx'], status: 'unverified' }
  ] };
  return { root, upstream, prepared, config, ledger, save, commit };
}

describe('explicit font theme module and pinned runtime compatibility', () => {
  it('keeps the three new packages exact-only at formal package entries', () => {
    expect(projectPackage(versions).dependencies).toMatchObject(versions);
    for (const [name, version] of Object.entries(versions)) for (const invalid of ['0.0.0', '^' + version, '~' + version, 'npm:' + name + '@' + version]) expect(() => projectPackage({ [name]: invalid })).toThrow();
  });
  it('proves synthetic unchanged colors without executing them', () => {
    expect(proveThemeStyleModule(Buffer.from(style))).toMatchObject({ parsedOnly: true, sourceSha256: digest(style), cssProperties: ['--background', '--primary', '--radius-scale'] });
  });
  it.each([
    ['network', style.replace('return { background:', "fetch('/synthetic'); return { background:")],
    ['storage', style.replace('surface.background', "localStorage.getItem('synthetic')")],
    ['native import', style.replace("'./registry'", "'@tauri-apps/api/core'")],
    ['dynamic import', style + "\nimport('./extra');"],
    ['top-level execution', style + '\nclamp(1,0,2);'],
    ['constructor', style.replace('Math.min', 'clamp.constructor')],
    ['computed capability', style.replace('Math.min', "Math['min']")],
    ['different DOM target', style.replace('document.documentElement', 'document.body')],
    ['DOM markup', style.replace("root.setAttribute('data-theme', theme);", "root.innerHTML = 'synthetic';")],
    ['different attribute', style.replace("'data-theme'", "'src'")],
    ['dynamic CSS key', style.replace("['--background',", '[tokens.background,')],
    ['non CSS property', style.replace("'--background'", "'background'")],
    ['root capability in value', style.replace('tokens.background]', 'root.classList]')],
    ['unknown helper', style.replace('Math.min', 'unknownHelper')],
    ['global shadow', style.replace('value: number, min:', 'Math: number, min:')],
  ])('rejects %s through the style proof', (_name, source) => { expect(() => proveThemeStyleModule(Buffer.from(source))).toThrow(); });
  it('retains private-content rejection for raw, escaped and assembled synthetic credentials without echoing them', () => {
    const marker = 'SYNTHETIC_NOT_A_REAL_CREDENTIAL_0123456789';
    const value = 'api_key="' + marker + '"';
    const escaped = [...value].map(character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    for (const expression of [JSON.stringify(value), '"' + escaped + '"', "'api_' + 'key=\"" + marker + "\"'"]) {
      let rejection: any; try { proveThemeStyleModule(Buffer.from(style.replace('surface.background', expression))); } catch (error) { rejection = error; }
      expect(rejection).toBeTruthy(); expect(String(rejection?.message).includes(marker)).toBe(false);
    }
    expect(() => proveThemeStyleModule(Buffer.alloc(1024 * 1024 + 1, 32))).toThrow();
    expect(() => proveThemeStyleModule(Buffer.from([0xff]))).toThrow();
  });
  it('retains exact original path and bytes, including with dirty and replacement source trees', async () => {
    const { upstream, config, prepared, commit } = await fixture();
    await writeFile(path.join(upstream, 'web/src/theme/tokens.ts'), 'dirty source kept');
    const bundle = await packPreparedEngineeringBundle(config), origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-prepared-origin.json')!.content);
    expect(origin.themeStyleModuleProof).toMatchObject({ sourcePath: 'web/src/theme/tokens.ts', preparedPath: 'src/theme/design-style.ts', sourceSha256: digest(style), parsedOnly: true });
    expect(bundle.sourceFiles.find(file => file.path === 'src/theme/design-style.ts')!.content).toBe(style);
    expect(await readFile(path.join(upstream, 'web/src/theme/tokens.ts'), 'utf8')).toBe('dirty source kept');
    await writeFile(path.join(upstream, 'web/src/theme/tokens.ts'), style + '\n// synthetic replacement');
    const replacement = await commit();
    await run('git', ['-C', upstream, 'replace', config.commit, replacement]);
    const pinned = await packPreparedEngineeringBundle(config);
    expect(pinned.sourceFiles.find(file => file.path === 'src/theme/design-style.ts')!.content).toBe(style);
    expect((await run('git', ['-C', upstream, 'show', `${config.commit}:web/src/theme/tokens.ts`])).stdout).toContain('synthetic replacement');
    await writeFile(path.join(prepared, 'src/theme/tokens.ts'), style);
    expect((await readPortableSourceFiles(prepared)).some(file => file.path === 'src/theme/tokens.ts')).toBe(false);
    await rm(path.join(prepared, 'src/theme/tokens.ts'));
    const raw = structuredClone(bundle); raw.sourceFiles.find(file => file.path === 'src/theme/design-style.ts')!.path = 'src/theme/tokens.ts';
    const { checksum: _checksum, ...payload } = raw; raw.checksum = digest(JSON.stringify(payload));
    expect(() => validatePortableProjectBundle(raw)).toThrow();
  });
  it.each(['absent profile', 'unmarked original protected file', 'wrong role', 'wrong original path', 'wrong prepared path', 'wrong digest', 'unused profile', 'duplicate style', 'hidden frontend', 'parent traversal', 'adapted bytes', 'split protected path'])('rejects %s without opening the generic path policy', async kind => {
    const { config, ledger, prepared, save } = await fixture(), item = ledger.stagedFiles[1];
    if (kind === 'absent profile') delete config.themeStyleModule;
    if (kind === 'unmarked original protected file') { delete config.themeStyleModule; delete item.sourceRole; }
    if (kind === 'wrong role') item.sourceRole = 'data-module';
    if (kind === 'wrong original path') item.sourcePath = 'web/src/theme/access-tokens.json';
    if (kind === 'wrong prepared path') item.path = 'src/theme/other.ts';
    if (kind === 'wrong digest') config.themeStyleModule!.sourceSha256 = '0'.repeat(64);
    if (kind === 'unused profile') ledger.stagedFiles.splice(1, 1);
    if (kind === 'duplicate style') ledger.stagedFiles.push({ ...item });
    if (kind === 'hidden frontend') config.themeStyleModule!.frontendDirectory = 'web/.private';
    if (kind === 'parent traversal') config.themeStyleModule!.frontendDirectory = '../web';
    if (kind === 'adapted bytes') { const changed = style + '\n// adapted'; await writeFile(path.join(prepared, item.path), changed); item.sha256 = digest(changed); }
    if (kind === 'split protected path') ledger.splitResources.push({ file: item.sourcePath, bytes: Buffer.byteLength(style), sha256: digest(style), chunks: ['src/synthetic-chunk.json'] });
    if (kind === 'split protected path') await writeFile(path.join(prepared, 'src/synthetic-chunk.json'), JSON.stringify({ base64: Buffer.from(style).toString('base64') }));
    await save(); await expect(packPreparedEngineeringBundle(config)).rejects.toThrow();
  });
  it('rejects a protected symlink and original oversized blob', async () => {
    const { upstream, config, commit, ledger, save } = await fixture();
    const file = path.join(upstream, 'web/src/theme/tokens.ts');
    await rm(file); await symlink('registry.ts', file);
    config.commit = await commit(); ledger.source.commit = config.commit; await save();
    await expect(packPreparedEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
    await rm(file); const oversized = style + '\n/*' + ' '.repeat(1024 * 1024) + '*/'; await writeFile(file, oversized);
    config.commit = await commit(); ledger.source.commit = config.commit;
    config.themeStyleModule!.sourceSha256 = digest(oversized); ledger.stagedFiles[1].sourceSha256 = digest(oversized); ledger.stagedFiles[1].sha256 = digest(oversized); await save();
    await expect(packPreparedEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_STYLE' });
  });
  it('packs/imports actual DnD and Prism, applies colors, and verifies/applies/reverts a candidate', async () => {
    const { root, upstream, config } = await fixture();
    const bundle = await packPreparedEngineeringBundle(config); expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const seed = await new DocumentStore(path.join(root, 'seed')).load('test');
    const catalog = await new ProjectWorkspace(path.join(root, 'catalog'), upstream, host).load(seed.project);
    const source = await catalog.validate((await catalog.import(bundle)).id);
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory));
    const runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start(); await runtime.page.locator('html[data-theme="light"]').waitFor();
      await runtime.page.dragAndDrop('[data-testid="drag"]', '[data-testid="drop"]');
      await expect.poll(() => runtime.page.getByTestId('drop-result').textContent()).toBe('dropped');
      expect(await runtime.page.locator('pre code').textContent()).toBe('const answer = 42;');
      const keyword = runtime.page.locator('pre code span').filter({ hasText: /^const$/ });
      expect(await keyword.count()).toBeGreaterThan(0);
      expect(await keyword.first().getAttribute('style')).toContain('color:');
      await runtime.page.getByRole('button', { name: 'Change theme' }).click(); await runtime.page.locator('html[data-theme="dark"]').waitFor();
      expect(await runtime.page.locator('html').evaluate(element => (element as HTMLElement).style.getPropertyValue('--background'))).toBe('#111827');
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'font-fixture-title')!;
      expect(target.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, host);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Synthetic font controls candidate', properties: { text: 'Synthetic controls checked' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified'); expect(change.evidence.every(item => item.passed)).toBe(true);
      await engine.apply(change.id, change.diffHash); await runtime.capture(); expect(await runtime.page.locator('h1').textContent()).toBe('Synthetic controls checked');
      await engine.revert(change.id); await runtime.capture(); expect(await runtime.page.locator('h1').textContent()).toBe('Synthetic font controls');
    } finally { await runtime.close(); }
  }, 60000);
});
