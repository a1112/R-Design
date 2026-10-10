import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { BrowserRuntime as BaselineRuntime } from '../../apps/bridge/src/runtime';
import { independentPort } from './browser-assertions';

const ownRoot = path.resolve(import.meta.dirname, '../..');
const deliveryRoot = path.resolve(ownRoot, '../deliverables');
const [toolDirectory, commit, ...requested] = process.argv.slice(2);
assert.ok(toolDirectory && /^[0-9a-f]{40}$/.test(commit ?? ''), 'Usage: verify-candidate.ts <tool-checkout-or-archive> <exact-tool-sha> [projects...]');
const toolRoot = path.resolve(toolDirectory);
const moduleAt = (file: string) => import(pathToFileURL(path.join(toolRoot, file)).href);
const { BrowserRuntime } = await moduleAt('apps/bridge/src/runtime.ts');
const { indexSources, transform } = await moduleAt('packages/source-binding/src/index.ts');
const { digest } = await moduleAt('packages/document-core/src/index.ts');
class CompatibilityRuntime extends BaselineRuntime {
  override config() {
    const config = super.config();
    for (const dependency of ['lucide-react', 'react-markdown', 'remark-gfm', 'i18next', 'react-i18next', 'react-router-dom', 'uplot', 'zod']) (config.resolve.alias as Record<string, string>)[dependency] = path.join(ownRoot, 'node_modules', dependency);
    return config;
  }
}
const names = requested.length ? requested : ['R-Box', 'R-Vault', 'R-Clip', 'R-Alpha', 'ModelBase', 'ToolBox', 'SaveDock'];
for (const name of names) {
  const hostReportFile = path.join(deliveryRoot, 'toolchain-evidence', name, 'report.json');
  const compatibilityReportFile = path.join(deliveryRoot, 'evidence', name, 'report.json');
  const host = JSON.parse(await readFile(hostReportFile, 'utf8'));
  const compatibility = JSON.parse(await readFile(compatibilityReportFile, 'utf8'));
  const actualHost = host.import === 'passed';
  const sourceRoot = actualHost ? host.importEvidence.sourceDirectory : path.join(deliveryRoot, 'staged', name);
  assert.ok(path.resolve(sourceRoot).startsWith(deliveryRoot + path.sep));
  const proof = actualHost ? host.mappingProof : compatibility.mappingProof;
  const bundle = JSON.parse(await readFile(path.join(deliveryRoot, 'bundles', name + '.rdesign-project.json'), 'utf8'));
  const mapped = bundle.document.project.snapshots.flatMap((frame: any) => frame.nodes).find((node: any) => node.binding?.file === proof.file && node.binding.line === proof.line && node.binding.reliability === 'exact' && node.binding.editableProperties.includes('text'));
  assert.ok(mapped?.sourceNodeId, name + ': exact captured source identity');
  const entries = await indexSources(sourceRoot);
  const targets = entries.get(mapped.sourceNodeId) ?? [];
  assert.equal(targets.length, 1, name + ': mapped candidate target');
  const target = targets[0];
  const original = await readFile(path.join(sourceRoot, target.binding.file));
  assert.equal(digest(original), target.binding.fileHash);
  const marker = '设计验证';
  const candidate = transform(target, { text: marker });
  const candidateRoot = path.join(deliveryRoot, 'candidates', name + '-' + randomUUID());
  await mkdir(path.dirname(candidateRoot), { recursive: true });
  await cp(sourceRoot, candidateRoot, { recursive: true, filter: file => !['dist', 'node_modules', '.rdesign'].includes(path.basename(file)) });
  await writeFile(path.join(candidateRoot, target.binding.file), candidate.after);
  const Runtime = actualHost ? BrowserRuntime : CompatibilityRuntime;
  const runtime = new Runtime(candidateRoot, actualHost ? toolRoot : ownRoot, 'candidate', await independentPort());
  const evidence: any = { status: 'pending', toolchainCommit: commit, mode: actualHost ? 'actual imported host without aliases' : 'temporary compatibility host with explicit dependency aliases; formal import blocked', file: target.binding.file, line: target.binding.line, sourceNodeId: target.binding.sourceNodeId, property: 'text', marker, candidateRoot, originalSourceUnchanged: false };
  try {
    await runtime.start();
    runtime.page.setDefaultTimeout(12000);
    await runtime.page.getByText(marker, { exact: true }).waitFor({ state: 'visible' });
    const frame = await runtime.capture('candidate');
    assert.ok(frame.nodes.some((node: any) => node.text === marker && node.binding?.file === target.binding.file && node.binding.reliability === 'exact'));
    await writeFile(path.join(deliveryRoot, actualHost ? 'toolchain-evidence' : 'evidence', name, 'candidate.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
    await runtime.build();
    assert.equal(digest(await readFile(path.join(sourceRoot, target.binding.file))), digest(original));
    evidence.status = 'passed'; evidence.renderedMarker = true; evidence.build = 'passed'; evidence.originalSourceUnchanged = true; evidence.exactCandidateMapping = true;
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); }
  finally { await runtime.close(); }
  compatibility.candidateEdit = evidence;
  if (actualHost) host.candidateEdit = evidence;
  else host.candidateEdit = { status: 'blocked', reason: 'Original bundle import rejected by dependency registry; only temporary compatibility candidate was executed' };
  await writeFile(compatibilityReportFile, JSON.stringify(compatibility, null, 2));
  await writeFile(hostReportFile, JSON.stringify(host, null, 2));
  console.log(JSON.stringify({ name, candidate: evidence.status, mode: evidence.mode, error: evidence.error }));
}
