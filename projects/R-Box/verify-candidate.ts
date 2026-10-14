import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { independentPort } from './browser-assertions';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const [toolDirectory, commit, ...requested] = process.argv.slice(2);
assert.ok(toolDirectory && /^[0-9a-f]{40}$/.test(commit ?? ''), 'Usage: verify-candidate.ts <exact-tool-archive> <tool-sha> [projects...]');
const toolRoot = path.resolve(toolDirectory);
const moduleAt = (file: string) => import(pathToFileURL(path.join(toolRoot, file)).href);
const { BrowserRuntime } = await moduleAt('apps/bridge/src/runtime.ts');
const { DocumentStore, digest } = await moduleAt('packages/document-core/src/index.ts');
const { codeHash } = await moduleAt('packages/source-binding/src/index.ts');
const { indexSources } = await moduleAt('packages/source-binding/src/index.ts');
const { ChangeEngine } = await moduleAt('packages/change-engine/src/index.ts');
const names = requested.length ? requested : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];

for (const name of names) {
  const reportFile = path.join(deliveryRoot, 'toolchain-evidence', name, 'report.json');
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  assert.equal(report.toolchainCommit, commit); assert.equal(report.import, 'passed');
  const sourceRoot = report.importEvidence.sourceDirectory;
  assert.ok(path.resolve(sourceRoot).startsWith(deliveryRoot + path.sep));
  const actualData = report.importEvidence.dataDirectory;
  assert.ok(actualData && path.resolve(actualData).startsWith(deliveryRoot + path.sep));
  const beforeRevision = await codeHash(sourceRoot);
  const bundlePath = path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json');
  const bundleHash = digest(await readFile(bundlePath));
  const store = await new DocumentStore(actualData).load(beforeRevision);
  const runtime = new BrowserRuntime(sourceRoot, toolRoot, 'live', await independentPort(), actualData);
  const evidence: any = { status: 'pending', toolchainCommit: commit, mode: 'actual ChangeEngine prepare/verify/apply/revert on isolated imported source without aliases',
    prepare: 'pending', verify: 'pending', apply: 'pending', revert: 'pending', originalSourceUnchanged: false, sourceRoot, beforeRevision };
  try {
    await runtime.start(); runtime.page.setDefaultTimeout(12000);
    await runtime.page.setViewportSize({ width: 1440, height: 960 });
    const frame = await runtime.capture();
    const target = frame.nodes.find((node: any) => node.text.trim() && node.binding?.file.startsWith('src/upstream/') && node.binding.reliability === 'exact' && node.binding.scope === 'instance' && node.binding.editableProperties.includes('text'));
    assert.ok(target?.sourceNodeId, name + ': unique static text target');
    const sourceFile = path.join(sourceRoot, target.binding.file);
    const original = await readFile(sourceFile);
    evidence.file = target.binding.file; evidence.line = target.binding.line; evidence.sourceNodeId = target.sourceNodeId; evidence.property = 'text'; evidence.marker = '设计验证';
    const engine = new ChangeEngine(store, runtime, toolRoot);
    const envelope = () => ({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: 'validate_' + randomUUID() });
    const request = { ...envelope(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId, version: frame,
      intent: 'Verify a static text edit in this disposable imported validation project, then accept and revert it.', properties: { text: evidence.marker }, scope: 'instance' };
    const change = await store.write(request, 'prepare:' + request.operationId, () => engine.prepare(request));
    evidence.prepare = 'passed'; evidence.changeId = change.id; evidence.diffHash = change.diffHash; evidence.candidateRoot = engine.candidateRoot(change.id);
    const verifyEnvelope = envelope();
    const verified = await store.write(verifyEnvelope, 'verify:' + change.id, () => engine.verify(change.id));
    evidence.verification = verified.evidence.map((item: any) => ({ name: item.name, passed: item.passed, detail: item.detail }));
    assert.equal(verified.status, 'verified', verified.error ?? JSON.stringify(evidence.verification));
    assert.ok(verified.candidateFrame.nodes.some((node: any) => node.text === evidence.marker && node.binding?.file === evidence.file && node.binding.reliability === 'exact'));
    await writeFile(path.join(deliveryRoot, 'toolchain-evidence', name, 'candidate.png'), Buffer.from(verified.candidateFrame.image.split(',')[1], 'base64'));
    evidence.verify = 'passed'; evidence.build = 'passed'; evidence.exactCandidateMapping = true;
    assert.equal(digest(await readFile(sourceFile)), digest(original), 'Candidate verification must leave imported source unchanged');
    const acceptEnvelope = envelope();
    await store.write(acceptEnvelope, 'apply:' + change.diffHash, () => engine.apply(change.id, change.diffHash));
    assert.equal(change.status, 'accepted'); assert.notEqual(digest(await readFile(sourceFile)), digest(original));
    await runtime.refreshSources(); await runtime.page.getByText(evidence.marker, { exact: true }).waitFor({ state: 'visible' });
    evidence.apply = 'passed'; evidence.acceptedMarkerVisible = true;
    const revertEnvelope = envelope();
    await store.write(revertEnvelope, 'revert:' + change.id, () => engine.revert(change.id));
    assert.equal(change.status, 'reverted');
    const metadata = await engine.metadata(change), originalText = metadata.mutations.find((mutation: any) => mutation.property === 'text').before;
    const restored = (await indexSources(sourceRoot)).get(target.sourceNodeId);
    assert.equal(restored?.length, 1);
    await runtime.refreshSources();
    assert.equal(await runtime.page.getByText(evidence.marker, { exact: true }).count(), 0);
    await runtime.page.getByText(originalText, { exact: true }).first().waitFor({ state: 'visible' });
    const restoredFrame = await runtime.capture();
    assert.ok(restoredFrame.nodes.some((node: any) => node.sourceNodeId === target.sourceNodeId && node.text === originalText && node.binding?.reliability === 'exact'));
    evidence.disposableImportedByteRestored = digest(await readFile(sourceFile)) === digest(original);
    evidence.revertCodeRevisionMatchesBefore = await codeHash(sourceRoot) === beforeRevision;
    evidence.revertSemantics = 'passed'; evidence.afterRevertFileHash = digest(await readFile(sourceFile)); evidence.beforeFileHash = digest(original);
    if (!evidence.disposableImportedByteRestored) evidence.revertLimitation = 'The host restores the original text through a JSX string expression; rendered text and mapping are restored but the original JSX byte spelling and code revision are not.';
    assert.equal(digest(await readFile(bundlePath)), bundleHash);
    evidence.revert = 'passed'; evidence.bundleUnchanged = true; evidence.originalSourceUnchanged = evidence.disposableImportedByteRestored; evidence.renderedMarker = true; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); }
  finally { await runtime.close(); }
  report.candidateEdit = evidence;
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  const preparedReportFile = path.join(deliveryRoot, 'evidence', name, 'report.json');
  const preparedReport = JSON.parse(await readFile(preparedReportFile, 'utf8')); preparedReport.candidateEdit = evidence;
  await writeFile(preparedReportFile, JSON.stringify(preparedReport, null, 2) + '\n');
  console.log(JSON.stringify({ name, candidate: evidence.status, prepare: evidence.prepare, verify: evidence.verify, apply: evidence.apply, revert: evidence.revert, error: evidence.error }));
  assert.equal(evidence.status, 'passed', name + ': candidate acceptance');
}
