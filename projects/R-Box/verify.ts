import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { captureScenario } from '../../packages/scenario-runner/src/index';
import { codeHash, transform, indexSources } from '../../packages/source-binding/src/index';
import { createProject, digest, DocumentStore } from '../../packages/document-core/src/index';
import { ProjectWorkspace } from '../../packages/project-workspace/src/index';
import type { RuntimeFrame, Scenario } from '../../packages/protocol/src/index';
import assert from 'node:assert/strict';
import { independentPort, interactions } from './browser-assertions';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(repoRoot, '../deliverables');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];
const binary = /\.(?:png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;


class PreviewRuntime extends BrowserRuntime {
  override config() {
    const config = super.config();
    const dependencies = ['lucide-react', 'react-markdown', 'remark-gfm', 'i18next', 'react-i18next', 'react-router-dom', 'uplot', 'zod'];
    for (const name of dependencies) (config.resolve.alias as Record<string, string>)[name] = path.join(repoRoot, 'node_modules', name);
    return config;
  }
}

async function sourceFiles(root: string) {
  const result: Array<{ path: string; content: string; sha256: string; encoding?: 'base64' }> = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name === 'dist') continue;
      const file = directory ? directory + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlink in staged source');
      if (entry.isDirectory()) await visit(file);
      else { const bytes = await readFile(path.join(root, file)); assert.ok(bytes.length <= 1048576, file); result.push({ path: file, content: bytes.toString(binary.test(file) ? 'base64' : 'utf8'), sha256: digest(bytes), ...(binary.test(file) ? { encoding: 'base64' as const } : {}) }); }
    }
  };
  await visit(''); return result.sort((a, b) => a.path.localeCompare(b.path));
}


for (const name of names) {
  const config = JSON.parse(await readFile(path.join(repoRoot, 'projects', name, 'engineering.json'), 'utf8'));
  const prepared = JSON.parse(await readFile(path.join(deliveryRoot, 'staged', name + '.prepared.json'), 'utf8'));
  assert.equal(path.resolve(prepared.sourceRoot), path.join(deliveryRoot, 'staged', name));
  await rm(path.join(prepared.sourceRoot, 'dist'), { recursive: true, force: true });
  const directory = path.join(deliveryRoot, 'evidence', name); await mkdir(directory, { recursive: true });
  const report: any = { name, source: config.source, rdesignBaseline: 'ffaba7c22b7d027e78ebccbbae17f2c5d4ba1ab7', verificationRuntime: 'base BrowserRuntime with explicit temporary frontend dependency aliases; host build defaults', checksum: null, schema: 'pending', import: 'pending', runtime: 'pending', mapping: 'pending', interaction: 'pending', scenes: [], interactions: [], errors: [], externalRequests: [] };
  const previewPort = await independentPort();
  report.previewPort = previewPort;
  const runtime = new PreviewRuntime(prepared.sourceRoot, repoRoot, 'live', previewPort);
  const snapshots: RuntimeFrame[] = [];
  try {
    await runtime.start();
    runtime.page.setDefaultTimeout(12000);
    await runtime.page.waitForFunction(() => {
      const root = document.getElementById('root');
      if (root?.getAttribute('role') === 'alert') throw new Error(root.textContent ?? 'preview failed');
      return Boolean(root?.children.length);
    }, undefined, { timeout: 15000 });
    runtime.page.on('pageerror', error => report.errors.push(error.message));
    runtime.page.on('request', request => { const url = new URL(request.url()); if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== runtime.url()) report.externalRequests.push(url.origin + url.pathname); });
    for (const raw of prepared.scenarios) {
      const scenario = raw as Scenario;
      try {
        const frame = await captureScenario(runtime, scenario);
        const upstream = frame.nodes.filter(node => node.binding?.file.startsWith('src/upstream/'));
        const exact = upstream.filter(node => node.binding?.reliability === 'exact');
        const editableText = exact.find(node => node.binding?.editableProperties.includes('text') && node.text.trim());
        snapshots.push(frame); scenario.snapshotId = frame.id; scenario.status = 'fresh';
        await writeFile(path.join(directory, scenario.id + '.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
        report.scenes.push({ id: scenario.id, route: scenario.route, viewport: scenario.viewport, passed: true, snapshotId: frame.id, exactMappings: exact.length, ambiguousMappings: upstream.filter(node => node.binding?.reliability === 'ambiguous').length, editableText: editableText ? { text: editableText.text.slice(0, 120), file: editableText.binding!.file, line: editableText.binding!.line } : null, documentWidth: await runtime.page.evaluate(() => document.documentElement.scrollWidth) });
      } catch (error) { report.scenes.push({ id: scenario.id, passed: false, error: String(error) }); }
      console.log(JSON.stringify({ name, scene: scenario.id, result: report.scenes.at(-1).passed }));
    }
    report.interactions = await interactions(name, runtime);
    const index = await indexSources(prepared.sourceRoot);
    const textNode = snapshots.flatMap(frame => frame.nodes).find(node => node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact' && node.binding.editableProperties.includes('text'));
    if (textNode?.sourceNodeId) { const entry = index.get(textNode.sourceNodeId)?.[0]; if (entry) { const candidate = transform(entry, { text: 'R-Design 验证（未写入）' }); report.mappingProof = { file: entry.binding.file, line: entry.binding.line, property: 'text', sourceHash: entry.binding.fileHash, transformedInMemory: candidate.after !== entry.source, writesPerformed: false }; } }
    try { await runtime.build(); report.build = 'passed'; } catch (error) { report.build = 'failed'; report.buildError = String(error); }
    report.runtime = report.scenes.every((scene: any) => scene.passed) && report.errors.length === 0 ? 'passed' : 'failed';
    report.mapping = report.mappingProof?.transformedInMemory ? 'passed' : 'failed';
    report.interaction = report.interactions.every((entry: any) => entry.passed) ? 'passed' : 'failed';
  } catch (error) { report.runtime = 'failed'; report.errors.push(String(error)); }
  finally { await runtime.close(); }
  await rm(path.join(prepared.sourceRoot, 'dist'), { recursive: true, force: true });
  // Build output is excluded from the portable source. No build configuration from upstream runs.
  const files = (await sourceFiles(prepared.sourceRoot)).filter(file => !file.path.startsWith('dist/'));
  const project = createProject(await codeHash(prepared.sourceRoot)); project.name = name + ' · 设计预览'; project.scenarios = prepared.scenarios; project.snapshots = snapshots;
  assert.ok(snapshots.every(frame => frame.codeRevision === project.codeRevision), 'Snapshot revision must describe the bundled source without build output');
  const timestamp = new Date().toISOString();
  const manifest = { schemaVersion: 1 as const, id: project.id, name: project.name, kind: 'owned' as const, template: 'blank' as const, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, favorite: false, archived: false, documentRevision: 1, codeRevision: project.codeRevision, source: { kind: 'owned' as const, directory: 'source' }, provenance: config.source };
  const payload = { format: 'rdesign-project' as const, schemaVersion: 1 as const, manifest, document: { schemaVersion: 1 as const, project, changes: [] }, sourceFiles: files };
  const bundle = { ...payload, checksum: digest(JSON.stringify(payload)) }; report.checksum = bundle.checksum; report.bundleBytes = Buffer.byteLength(JSON.stringify(bundle)); report.sourceFiles = files.length;
  await mkdir(path.join(deliveryRoot, 'bundles'), { recursive: true }); await writeFile(path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json'), JSON.stringify(bundle));
  assert.equal(digest(JSON.stringify(payload)), bundle.checksum); assert.ok(files.every(file => digest(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')) === file.sha256));
  report.integrity = 'passed';
  const validationRoot = path.join(deliveryRoot, 'imports', name + '-' + randomUUID());
  try {
    const linked = path.join(validationRoot, 'linked'); await mkdir(path.join(linked, 'src'), { recursive: true });
    await writeFile(path.join(linked, 'src/main.tsx'), 'export {};\n'); await writeFile(path.join(linked, 'index.html'), '<html></html>');
    const store = await new DocumentStore(path.join(validationRoot, 'data')).load('seed');
    const catalog = await new ProjectWorkspace(path.join(validationRoot, 'data'), linked, repoRoot).load(store.project);
    const one = await catalog.import(bundle); const two = await catalog.import(bundle);
    assert.notEqual(one.id, two.id); assert.notEqual(one.id, project.id);
    const imported = JSON.parse(await readFile(path.join(catalog.get(one.id).dataDirectory, 'project.json'), 'utf8'));
    assert.ok(imported.project.scenarios.every((scenario: Scenario) => scenario.status === 'unverified'));
    report.schema = 'passed'; report.import = 'passed'; report.importEvidence = { identitiesDistinct: true, importedIds: [one.id, two.id], incomingId: project.id, scenariosResetToUnverified: true };
  } catch (error) { report.schema = 'blocked'; report.import = 'blocked'; report.importError = { code: (error as any).code, message: String(error) }; }
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, runtime: report.runtime, build: report.build, mapping: report.mapping, interaction: report.interaction, schema: report.schema, import: report.import, checksum: report.checksum }));
}
