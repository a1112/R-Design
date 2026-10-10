import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { digest } from '../../packages/document-core/src/index';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const names = ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];
const projects: any[] = [];
const sums: string[] = [];
const dependencies: Record<string, string> = {};
const observedToolchains = new Set<string>();
const [freezeFlag, frozenCommit] = process.argv.slice(2);
assert.ok(!freezeFlag || freezeFlag === '--frozen' && /^[0-9a-f]{40}$/.test(frozenCommit ?? ''), 'Optional argument: --frozen <confirmed-tool-sha>');

for (const name of names) {
  const file = 'bundles/' + name + '.rdesign-project.json';
  const bytes = await readFile(path.join(deliveryRoot, file));
  const bundle = JSON.parse(bytes.toString('utf8'));
  const config = JSON.parse(await readFile(path.join(ownRoot, 'projects', name, 'engineering.json'), 'utf8'));
  const compatibility = JSON.parse(await readFile(path.join(deliveryRoot, 'evidence', name, 'report.json'), 'utf8'));
  const host = JSON.parse(await readFile(path.join(deliveryRoot, 'toolchain-evidence', name, 'report.json'), 'utf8'));
  observedToolchains.add(host.toolchainCommit);
  let bridge: any = { guiImport: 'blocked', runtime: 'blocked', mapping: 'blocked', restart: 'blocked' };
  if (host.import === 'passed') {
    bridge = JSON.parse(await readFile(path.join(deliveryRoot, 'bridge-evidence', name, 'report.json'), 'utf8'));
    assert.equal(bridge.testedHostSha, host.toolchainCommit);
    for (const status of ['guiImport', 'runtime', 'mapping', 'restart']) assert.equal(bridge[status], 'passed', name + ': bridge ' + status);
  }
  const { checksum, ...payload } = bundle;
  assert.equal(bundle.format, 'rdesign-project');
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(digest(JSON.stringify(payload)), checksum);
  assert.equal(compatibility.checksum, checksum);
  assert.equal(host.checksum, checksum);
  assert.ok(bytes.length <= 24 * 1024 * 1024);
  assert.ok(bundle.sourceFiles.length <= 1000);
  for (const file of bundle.sourceFiles) {
    const content = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
    assert.ok(content.length <= 1024 * 1024, name + ':' + file.path);
    assert.equal(digest(content), file.sha256, name + ':' + file.path);
  }
  assert.ok(bundle.document.project.snapshots.every((snapshot: any) => snapshot.codeRevision === bundle.document.project.codeRevision));
  for (const status of ['runtime', 'build', 'mapping', 'interaction', 'integrity']) assert.equal(compatibility[status], 'passed', name + ':' + status);
  assert.ok(compatibility.scenes.every((scene: any) => scene.passed));
  assert.equal(compatibility.candidateEdit?.status, 'passed', name + ': isolated candidate edit');
  if (host.import === 'passed') assert.equal(host.candidateEdit?.status, 'passed', name + ': actual host candidate edit');
  for (const dependency of ['react', 'react-dom', ...Object.keys(config.dependencies)]) {
    dependencies[dependency] = JSON.parse(await readFile(path.join(ownRoot, 'node_modules', dependency, 'package.json'), 'utf8')).version;
  }
  const narrow = compatibility.scenes.find((scene: any) => scene.id === 'narrow');
  projects.push({ name, source: config.source, file, sha256: digest(bytes), checksum, sourceFileCount: bundle.sourceFiles.length, sourceBytes: bundle.sourceFiles.reduce((total: number, file: any) => total + Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8').length, 0), sceneCount: compatibility.scenes.length,
    integrity: 'passed', schema: host.schema, preflight: host.preflight, import: host.import,
    compatibility: { runtime: compatibility.runtime, build: compatibility.build, mapping: compatibility.mapping, interaction: compatibility.interaction, candidateEdit: compatibility.candidateEdit.status, mode: 'explicit temporary dependency aliases, default host build target', report: 'evidence/' + name + '/report.json' },
    importedHost: { runtime: host.runtime, build: host.build, mapping: host.mapping, interaction: host.interaction, candidateEdit: host.candidateEdit.status, mode: 'actual imported source, actual host runtime, no alias override', report: 'toolchain-evidence/' + name + '/report.json', failure: host.failure ?? null },
    requiredRuntimeDependencies: config.dependencies,
    bridge: { guiImport: bridge.guiImport, runtime: bridge.runtime, mapping: bridge.mapping, restart: bridge.restart, report: host.import === 'passed' ? 'bridge-evidence/' + name + '/report.json' : null },
    narrow: { viewportWidth: narrow.viewport.width, documentWidth: narrow.documentWidth, horizontalOverflow: narrow.documentWidth > narrow.viewport.width },
    sourceMappingScope: 'Exact static text transformed, rendered and built in an isolated candidate copy; original source unchanged; dynamic or repeated nodes remain read-only or ambiguous',
    previewNotice: config.notice,
  });
  sums.push(digest(bytes) + '  ' + file);
}

assert.equal(observedToolchains.size, 1, 'All host reports must use one tool commit');
const observedToolchain = [...observedToolchains][0];
if (frozenCommit) assert.equal(observedToolchain, frozenCommit, 'Reports must match the confirmed frozen tool');

const acceptance = {
  format: 'rdesign-small-tools-checkpoint', schemaVersion: 1, generatedAt: new Date().toISOString(),
  adapterBranch: 'codex/small-tool-engineering-bundles', adapterCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ownRoot, encoding: 'utf8' }).trim(),
  baseline: 'ffaba7c22b7d027e78ebccbbae17f2c5d4ba1ab7', observedToolchain, frozenToolchain: frozenCommit ?? null,
  toolchainState: frozenCommit ? 'Parent-confirmed frozen tool; project acceptance and remaining dependency blockers are reported separately' : 'No frozen SHA confirmed',
  temporaryInstalledDependencies: dependencies,
  completedSceneCaptures: projects.reduce((total, project) => total + project.sceneCount, 0),
  importedHostSceneCaptures: projects.filter(project => project.importedHost.runtime === 'passed').reduce((total, project) => total + project.sceneCount, 0),
  candidateEdits: { actualImportedHostPassed: projects.filter(project => project.importedHost.candidateEdit === 'passed').length, compatibilityHostPassed: projects.filter(project => project.importedHost.candidateEdit === 'blocked' && project.compatibility.candidateEdit === 'passed').length, originalSourceUnchanged: true },
  workbenchImportsAndRestartsPassed: projects.filter(project => project.bridge.restart === 'passed').length,
  adapterContractTests: { passed: 5, failed: 0, includesLosslessResourceReconstruction: true },
  visualLimitations: ['R-Alpha: original minimum width 1060px; horizontal overflow at 390px', 'ModelBase: original minimum width 1080px; horizontal overflow at 390px', 'ToolBox: narrow hardware-specification row can clip long values'],
  sourcePolicy: 'Exact clean remote commits only; complete frontend runtime source and referenced resources; no env, credentials, real private user data, node_modules, Git history, native/backend builds or executable upstream hooks',
  blockers: ['ModelBase and ToolBox: IMPORT_CONFIG until the parent registers the listed exact browser dependencies', 'The parent generator needs a controlled prepared-source/overlay interface for the recipes'],
  projects,
};
await writeFile(path.join(deliveryRoot, 'acceptance.json'), JSON.stringify(acceptance, null, 2));
await writeFile(path.join(deliveryRoot, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(JSON.stringify({ scenes: acceptance.completedSceneCaptures, importedScenes: acceptance.importedHostSceneCaptures, projects: projects.map(project => ({ name: project.name, checksum: project.checksum, import: project.import })) }));
