/** v1 candidate writer. Final registry/import acceptance must use the parent's frozen tool. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { codeHash } from '../../../packages/source-binding/src/index.js';
import { createProject, digest } from '../../../packages/document-core/src/index.js';
import { ProjectWorkspace } from '../../../packages/project-workspace/src/index.js';
import { repoRoot } from './prepare.mjs';
import { preflightBundle } from './preflight.js';
import { frozenRoot, frozenSha, hostModule } from './frozen-host.mjs';

const name = process.argv[2] ?? 'R-ShareMouse';
const root = path.join(repoRoot, '.rdesign/desktop-prepared', name);
const config = JSON.parse(await readFile(path.join(repoRoot, 'projects', name, 'adapter.json'), 'utf8'));
const sourceFiles: Array<{ path: string; content: string; sha256: string; encoding?: 'base64' }> = [];
const binary = /\.(?:png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;
async function visit(relative: string) {
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (relative || entry.name === 'src') await visit(file); continue; }
    if (!entry.isFile() || (!relative && !['index.html', 'package.json'].includes(entry.name))) continue;
    const bytes = await readFile(path.join(root, file)); assert(bytes.length <= 1024 * 1024, `${file} exceeds the v1 file limit`);
    sourceFiles.push({ path: file, content: bytes.toString(binary.test(file) ? 'base64' : 'utf8'), sha256: digest(bytes), ...(binary.test(file) ? { encoding: 'base64' as const } : {}) });
  }
}
await visit(''); assert(sourceFiles.length <= 1000);
sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
const revision = await codeHash(root), now = new Date().toISOString(), id = `project_${randomUUID()}`;
const project = createProject(revision); project.id = id; project.name = `${name} · 完整前端设计工程`; project.scenarios = config.scenarios;
const evidenceRoot = path.join(repoRoot, '.rdesign/desktop-evidence', name);
for (const scenario of project.scenarios) {
  try { const frame = JSON.parse(await readFile(path.join(evidenceRoot, `${scenario.id}.frame.json`), 'utf8')); assert.equal(frame.codeRevision, revision, 'Screenshot evidence must match the current adapted source'); project.snapshots.push(frame); scenario.snapshotId = frame.id; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const manifest = { schemaVersion: 1, id, name: project.name, kind: 'owned', template: 'blank', createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: 1, codeRevision: revision, source: { kind: 'owned', directory: 'source' }, upstream: config.source };
const payload = { format: 'rdesign-project', schemaVersion: 1, manifest, document: { schemaVersion: 1, project, changes: [] }, sourceFiles };
const encoded = JSON.stringify(payload); assert(Buffer.byteLength(encoded) <= 24 * 1024 * 1024);
const bundle = { ...payload, checksum: digest(encoded) };
const preflight = await preflightBundle(bundle);
const destination = path.join(repoRoot, '.rdesign/desktop-deliverables'); await mkdir(destination, { recursive: true });
const output = path.join(destination, `${name}.rdesign-project.json`); await writeFile(output, JSON.stringify(bundle));
const persisted = JSON.parse(await readFile(output, 'utf8')); const { checksum, ...rest } = persisted; assert.equal(digest(JSON.stringify(rest)), checksum);
for (const file of persisted.sourceFiles) assert.equal(digest(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')), file.sha256);
let importStatus: any;
const { ProjectWorkspace: FrozenWorkspace } = await hostModule('packages/project-workspace/src/index.ts');
const { preflightEngineeringBundle } = await hostModule('packages/project-workspace/src/engineering.ts');
let frozenPreflight: any;
try { frozenPreflight = preflightEngineeringBundle(bundle); }
catch (error) { frozenPreflight = { passed: false, code: (error as any).code, detail: (error as Error).message }; }
const workspace = new FrozenWorkspace(path.join(repoRoot, '.rdesign/desktop-frozen-import', name), root, frozenRoot);
await workspace.load(project);
try { const imported = await workspace.import(bundle); importStatus = { status: 'passed', id: imported.id, isolated: imported.id !== id }; }
catch (error) { importStatus = { status: 'blocked', code: (error as any).code, detail: (error as Error).message, baseline: frozenSha, required: 'Explicit host dependency compatibility support' }; }
const report = { name, source: config.source, format: 'rdesign-project', schemaVersion: 1, candidate: true, checksum, fileSha256: digest(await readFile(output)), bytes: Buffer.byteLength(JSON.stringify(bundle)), sourceFiles: sourceFiles.length, snapshots: project.snapshots.length, perFileIntegrity: 'passed', payloadIntegrity: 'passed', preflight, frozenPreflight, import: importStatus, finalFrozenToolAcceptance: importStatus.status === 'passed' && frozenPreflight.passed ? 'passed' : 'blocked' };
await writeFile(path.join(repoRoot, 'projects', name, 'bundle-summary.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, ...report }, null, 2));
