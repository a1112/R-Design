import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { independentPort, interactions } from './browser-assertions';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const [toolDirectory, commit, ...requested] = process.argv.slice(2);
assert.ok(toolDirectory && /^[0-9a-f]{40}$/.test(commit ?? ''), 'Usage: pack.ts <exact-tool-archive> <tool-sha> [projects...]');
const toolRoot = path.resolve(toolDirectory);
const moduleAt = (file: string) => import(pathToFileURL(path.join(toolRoot, file)).href);
const { validatePortableProjectBundle } = await moduleAt('packages/project-workspace/src/index.ts');
const { preflightEngineeringBundle } = await moduleAt('packages/project-workspace/src/engineering.ts');
const { BrowserRuntime } = await moduleAt('apps/bridge/src/runtime.ts');
const { digest } = await moduleAt('packages/document-core/src/index.ts');
const { codeHash, indexSources, transform } = await moduleAt('packages/source-binding/src/index.ts');
const { captureScenario } = await moduleAt('packages/scenario-runner/src/index.ts');
const execute = promisify(execFile);
const names = requested.length ? requested : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];

for (const name of names) {
  const recipe = JSON.parse(await readFile(path.join(ownRoot, 'projects', name, 'engineering.json'), 'utf8'));
  const prepared = JSON.parse(await readFile(path.join(deliveryRoot, 'staged', name + '.prepared.json'), 'utf8'));
  assert.equal(path.resolve(prepared.sourceRoot), path.join(deliveryRoot, 'staged', name));
  assert.equal(prepared.source.commit, recipe.source.commit);
  const output = path.join(deliveryRoot, 'evidence', name);
  await mkdir(output, { recursive: true });
  const run = await mkdtemp(path.join(output, 'pack-'));
  const config = { repositoryRoot: path.resolve(ownRoot, '../sources', name), repositoryUrl: 'https://github.com/' + recipe.source.repository,
    commit: recipe.source.commit, name: name + ' · 设计预览', preparedDirectory: prepared.sourceRoot,
    provenanceFile: 'src/rdesign-preview/provenance.json', scenarios: prepared.scenarios, limitations: [recipe.notice,
      'Disposable browser fixture only; unauthorized; native IPC, clipboard, external services and file mutations reject explicitly.',
      'Dynamic and repeated JSX remains read-only or ambiguous; original narrow-screen layout limitations are retained.'] };
  const configPath = path.join(run, 'prepared-config.json'), packedPath = path.join(run, 'packed.rdesign.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const cli = await execute(process.execPath, ['--import', 'tsx', path.join(toolRoot, 'scripts/engineering.ts'), 'pack-prepared', configPath, packedPath], { cwd: toolRoot, maxBuffer: 1024 * 1024 });
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(cliReport.passed, true);
  const bundle = JSON.parse(await readFile(packedPath, 'utf8'));
  const captureRoot = path.join(run, 'source');
  for (const file of bundle.sourceFiles) {
    const target = path.join(captureRoot, file.path); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'));
  }
  assert.equal(await codeHash(captureRoot), bundle.document.project.codeRevision);
  const origin = JSON.parse(bundle.sourceFiles.find((file: any) => file.path === 'src/rdesign-prepared-origin.json').content);
  assert.equal(origin.commit, recipe.source.commit);
  for (const file of origin.preparedFileHashes) assert.equal(bundle.sourceFiles.find((item: any) => item.path === file.path)?.sha256, file.sha256);
  const report: any = { name, source: recipe.source, toolchainCommit: commit, verificationRuntime: 'official pack-prepared CLI followed by actual host runtime without aliases',
    generation: { command: 'pack-prepared', config: configPath, rawBundle: packedPath, rawChecksum: bundle.checksum, provenanceVerified: true, originalResourceBytesVerified: true, originFile: 'src/rdesign-prepared-origin.json', cliReport },
    checksum: null, schema: 'pending', preflight: 'pending', runtime: 'pending', mapping: 'pending', interaction: 'pending', build: 'pending', scenes: [], errors: [], externalRequests: [] };
  const runtime = new BrowserRuntime(captureRoot, toolRoot, 'live', await independentPort());
  report.previewPort = runtime.port;
  try {
    await runtime.start(); runtime.page.setDefaultTimeout(12000);
    runtime.page.on('pageerror', (error: Error) => report.errors.push(error.message));
    runtime.page.on('request', (request: any) => { const url = new URL(request.url()); if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== runtime.url()) report.externalRequests.push(url.origin + url.pathname); });
    for (const scenario of bundle.document.project.scenarios) {
      const frame = await captureScenario(runtime, scenario);
      assert.equal(frame.codeRevision, bundle.document.project.codeRevision);
      bundle.document.project.snapshots.push(frame); scenario.snapshotId = frame.id; scenario.status = 'fresh';
      await writeFile(path.join(output, scenario.id + '.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
      const nodes = frame.nodes.filter((node: any) => node.binding?.file.startsWith('src/upstream/'));
      report.scenes.push({ id: scenario.id, route: scenario.route, viewport: scenario.viewport, passed: true, snapshotId: frame.id,
        exactMappings: nodes.filter((node: any) => node.binding.reliability === 'exact').length,
        ambiguousMappings: nodes.filter((node: any) => node.binding.reliability === 'ambiguous').length,
        documentWidth: await runtime.page.evaluate(() => document.documentElement.scrollWidth) });
      console.log(JSON.stringify({ name, scene: scenario.id, officialPackedSource: 'passed' }));
    }
    report.interactions = await interactions(name, runtime);
    assert.ok(report.interactions.every((item: any) => item.passed)); report.interaction = 'passed';
    const index = await indexSources(captureRoot);
    const node = bundle.document.project.snapshots.flatMap((frame: any) => frame.nodes).find((node: any) => node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact' && node.binding.editableProperties.includes('text'));
    const target = index.get(node?.sourceNodeId)?.[0]; assert.ok(target);
    assert.notEqual(transform(target, { text: 'R-Design 验证（未写入）' }).after, target.source);
    report.mappingProof = { file: target.binding.file, line: target.binding.line, sourceNodeId: target.binding.sourceNodeId, transformedInMemory: true, writesPerformed: false }; report.mapping = 'passed';
    await runtime.build(); report.build = 'passed';
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.runtime = 'passed';
  } finally { await runtime.close(); }
  const { checksum: _old, ...payload } = bundle;
  bundle.checksum = digest(JSON.stringify(payload));
  validatePortableProjectBundle(bundle); report.schema = 'passed';
  report.preflightEvidence = preflightEngineeringBundle(bundle); assert.equal(report.preflightEvidence.passed, true); report.preflight = 'passed';
  report.checksum = bundle.checksum; report.integrity = 'passed'; report.sourceFiles = bundle.sourceFiles.length;
  await mkdir(path.join(deliveryRoot, 'bundles'), { recursive: true });
  await writeFile(path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json'), JSON.stringify(bundle) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ name, generatedWith: 'pack-prepared', toolchain: commit, checksum: bundle.checksum, schema: report.schema, preflight: report.preflight, runtime: report.runtime, build: report.build }));
}
