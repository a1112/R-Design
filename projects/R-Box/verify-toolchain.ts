import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { independentPort, interactions } from './browser-assertions';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const [toolDirectory, commit, ...requested] = process.argv.slice(2);
assert.ok(toolDirectory && /^[0-9a-f]{40}$/.test(commit ?? ''), 'Usage: verify-toolchain.ts <tool-checkout-or-archive> <exact-tool-sha> [projects...]');
const toolRoot = path.resolve(toolDirectory);
const moduleAt = (file: string) => import(pathToFileURL(path.join(toolRoot, file)).href);
const { ProjectWorkspace, validatePortableProjectBundle } = await moduleAt('packages/project-workspace/src/index.ts');
const { preflightEngineeringBundle } = await moduleAt('packages/project-workspace/src/engineering.ts');
const { BrowserRuntime } = await moduleAt('apps/bridge/src/runtime.ts');
const { DocumentStore, digest } = await moduleAt('packages/document-core/src/index.ts');
const { captureScenario } = await moduleAt('packages/scenario-runner/src/index.ts');
const { indexSources, transform } = await moduleAt('packages/source-binding/src/index.ts');
const toolFiles = ['packages/project-workspace/src/index.ts', 'packages/project-workspace/src/engineering.ts', 'packages/project-workspace/src/prepared-engineering.ts', 'packages/project-workspace/src/runtime-dependencies.ts', 'packages/change-engine/src/index.ts', 'packages/source-binding/src/index.ts', 'apps/bridge/src/runtime.ts', 'apps/bridge/src/runtime-dependencies.ts'];
const moduleHashes = Object.fromEntries(await Promise.all(toolFiles.map(async file => [file, digest(await readFile(path.join(toolRoot, file)))])));
const names = requested.length ? requested : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];

for (const name of names) {
  const bundle = JSON.parse(await readFile(path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(ownRoot, 'projects', name, 'engineering.json'), 'utf8')).source;
  const directory = path.join(deliveryRoot, 'toolchain-evidence', name);
  await mkdir(directory, { recursive: true });
  const report: any = { name, source, toolchainCommit: commit, toolchainModuleHashes: moduleHashes, checksum: bundle.checksum, schema: 'pending', preflight: 'pending', import: 'pending', runtime: 'pending', build: 'pending', mapping: 'pending', interaction: 'pending', scenes: [], errors: [], externalRequests: [], hostDependencies: {} };
  const declared = JSON.parse(bundle.sourceFiles.find((file: any) => file.path === 'package.json').content).dependencies;
  for (const [dependency, version] of Object.entries(declared)) {
    if (dependency === '@rdesign/runtime-web') continue;
    try {
      const installed = JSON.parse(await readFile(path.join(toolRoot, 'node_modules', dependency, 'package.json'), 'utf8')).version;
      report.hostDependencies[dependency] = { declared: version, installed };
    } catch { report.hostDependencies[dependency] = { declared: version, installed: null }; }
  }
  let runtime: any;
  try {
    validatePortableProjectBundle(bundle);
    report.schema = 'passed';
    const preflight = preflightEngineeringBundle(bundle);
    report.preflightEvidence = preflight;
    report.preflight = preflight.passed ? 'passed' : 'failed';
    assert.equal(preflight.passed, true, preflight.errors.join('\n'));
    const root = path.join(deliveryRoot, 'imports', name + '-toolchain-' + randomUUID());
    const linked = path.join(root, 'linked');
    await mkdir(path.join(linked, 'src'), { recursive: true });
    await writeFile(path.join(linked, 'src/main.tsx'), 'export {};\n');
    await writeFile(path.join(linked, 'index.html'), '<html></html>');
    const store = await new DocumentStore(path.join(root, 'data')).load('seed');
    const catalog = await new ProjectWorkspace(path.join(root, 'data'), linked, toolRoot).load(store.project);
    const one = await catalog.import(bundle), two = await catalog.import(bundle);
    assert.notEqual(one.id, two.id);
    assert.notEqual(one.id, bundle.document.project.id);
    const entry = catalog.get(one.id);
    const imported = JSON.parse(await readFile(path.join(entry.dataDirectory, 'project.json'), 'utf8'));
    assert.ok(imported.project.scenarios.every((scenario: any) => scenario.status === 'unverified'));
    let preserved = 0;
    for (const file of bundle.sourceFiles) {
      if (file.path === 'package.json') continue; // The importer creates the controlled host package.
      assert.equal(digest(await readFile(path.join(entry.sourceDirectory, file.path))), file.sha256, file.path);
      preserved++;
    }
    report.import = 'passed';
    report.importEvidence = { identitiesDistinct: true, incomingId: bundle.document.project.id, importedIds: [one.id, two.id], scenariosResetToUnverified: true, sourceFilesPreserved: preserved, sourceDirectory: entry.sourceDirectory, dataDirectory: entry.dataDirectory };
    report.previewPort = await independentPort();
    // The actual host runtime and imported source are used without package aliases or build-target overrides.
    runtime = new BrowserRuntime(entry.sourceDirectory, toolRoot, 'live', report.previewPort);
    await runtime.start();
    runtime.page.setDefaultTimeout(12000);
    await runtime.page.waitForFunction(() => {
      const root = document.getElementById('root');
      if (root?.getAttribute('role') === 'alert') throw new Error(root.textContent ?? 'preview failed');
      return Boolean(root?.children.length);
    }, undefined, { timeout: 15000 });
    runtime.page.on('pageerror', (error: Error) => report.errors.push(error.message));
    runtime.page.on('request', (request: any) => { const url = new URL(request.url()); if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== runtime.url()) report.externalRequests.push(url.origin + url.pathname); });
    const frames: any[] = [];
    for (const scenario of imported.project.scenarios) {
      try {
        const frame = await captureScenario(runtime, scenario);
        frames.push(frame);
        await writeFile(path.join(directory, scenario.id + '.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
        const nodes = frame.nodes.filter((node: any) => node.binding?.file.startsWith('src/upstream/'));
        const documentWidth = await runtime.page.evaluate(() => document.documentElement.scrollWidth);
        report.scenes.push({ id: scenario.id, viewport: scenario.viewport, passed: true, exactMappings: nodes.filter((node: any) => node.binding.reliability === 'exact').length, ambiguousMappings: nodes.filter((node: any) => node.binding.reliability === 'ambiguous').length, documentWidth, horizontalOverflow: documentWidth > scenario.viewport.width });
      } catch (error) { report.scenes.push({ id: scenario.id, passed: false, error: String(error) }); }
      console.log(JSON.stringify({ name, scene: scenario.id, importedRuntime: report.scenes.at(-1).passed }));
    }
    report.interactions = await interactions(name, runtime);
    report.interaction = report.interactions.every((item: any) => item.passed) ? 'passed' : 'failed';
    const index = await indexSources(entry.sourceDirectory);
    const mapped = frames.flatMap(frame => frame.nodes).find((node: any) => node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact' && node.binding.editableProperties.includes('text'));
    const target = mapped?.sourceNodeId && index.get(mapped.sourceNodeId)?.[0];
    if (target) report.mappingProof = { file: target.binding.file, line: target.binding.line, sourceNodeId: target.binding.sourceNodeId, property: 'text', transformedInMemory: transform(target, { text: 'R-Design 验证（未写入）' }).after !== target.source, writesPerformed: false };
    report.mapping = report.mappingProof?.transformedInMemory ? 'passed' : 'failed';
    try { await runtime.build(); report.build = 'passed'; } catch (error) { report.build = 'failed'; report.buildError = String(error); }
    report.runtime = report.scenes.every((item: any) => item.passed) && report.errors.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    report.failure = { code: (error as any).code, message: String(error) };
    if (report.schema === 'pending') report.schema = 'blocked';
    if (report.preflight === 'pending') report.preflight = 'blocked';
    if (report.import === 'pending') report.import = 'blocked';
    if (report.runtime === 'pending') report.runtime = report.import === 'passed' ? 'failed' : 'blocked';
    if (report.import === 'blocked') for (const status of ['build', 'mapping', 'interaction']) if (report[status] === 'pending') report[status] = 'blocked';
  } finally { await runtime?.close(); }
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, toolchain: commit, checksum: bundle.checksum, schema: report.schema, preflight: report.preflight, import: report.import, runtime: report.runtime, build: report.build, interaction: report.interaction, failure: report.failure }));
  for (const status of ['schema', 'preflight', 'import', 'runtime', 'build', 'mapping', 'interaction']) assert.equal(report[status], 'passed', name + ': ' + status);
  assert.deepEqual(report.externalRequests, [], name + ': external requests');
}
