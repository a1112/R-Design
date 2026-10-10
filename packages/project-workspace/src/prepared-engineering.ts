import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject, digest, DomainError } from '../../document-core/src/index.js';
import { codeHash } from '../../source-binding/src/index.js';
import { assertPortableSourcePaths, isPrivateSourceName, readPortableSourceFiles, validatePortableProjectBundle, type ProjectManifest, type PortableProjectBundle } from './index.js';
import { committedGit, preflightEngineeringBundle, type EngineeringConfig } from './engineering.js';

/** Prepared files are explicit adapter output, never executed by this packer. */
export interface PreparedEngineeringConfig extends Pick<EngineeringConfig, 'repositoryRoot' | 'repositoryUrl' | 'commit' | 'name' | 'scenarios' | 'limitations'> {
  preparedDirectory: string;
  provenanceFile: string;
}

export async function packPreparedEngineeringBundle(config: PreparedEngineeringConfig): Promise<PortableProjectBundle> {
  const git = await committedGit(config);
  const sourceFiles = await readPortableSourceFiles(config.preparedDirectory);
  assertPortableSourcePaths([config.provenanceFile]);
  const files = new Map(sourceFiles.map(file => [file.path, file]));
  const bytes = (file: string) => {
    const item = files.get(file);
    if (!item) throw new DomainError('ENGINEERING_PROVENANCE', '预备工程缺少登记文件: ' + file, 400);
    return Buffer.from(item.content, item.encoding === 'base64' ? 'base64' : 'utf8');
  };
  const ledger = JSON.parse(bytes(config.provenanceFile).toString('utf8'));
  const repository = config.repositoryUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (ledger.schemaVersion !== 1 || ledger.source?.repository !== repository || ledger.source?.commit !== config.commit || !Array.isArray(ledger.stagedFiles) || !ledger.stagedFiles.length || ledger.stagedFiles.length > 1000 || !Array.isArray(ledger.splitResources) || ledger.splitResources.length > 1000) throw new DomainError('ENGINEERING_PROVENANCE', '预备工程来源账本不匹配', 400);
  const original = async (file: string) => {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..' || isPrivateSourceName(part))) throw new DomainError('ENGINEERING_PROVENANCE', '原始文件路径无效', 400);
    const record = (await git(['ls-tree', config.commit, '--', file])).toString('utf8').trim();
    if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(record) || record.slice(record.indexOf('\t') + 1) !== file) throw new DomainError('ENGINEERING_PROVENANCE', '来源必须是提交中的常规文件', 400);
    return git(['show', config.commit + ':' + file], 24 * 1024 * 1024 + 1);
  };
  for (const item of ledger.stagedFiles) {
    assertPortableSourcePaths([item.path]);
    if (!/^[0-9a-f]{64}$/.test(item.sourceSha256) || !/^[0-9a-f]{64}$/.test(item.sha256) || digest(await original(item.sourcePath)) !== item.sourceSha256 || digest(bytes(item.path)) !== item.sha256) throw new DomainError('ENGINEERING_PROVENANCE', '原始或适配文件摘要不匹配: ' + item.path, 400);
  }
  for (const item of ledger.splitResources) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 24 * 1024 * 1024 || !Array.isArray(item.chunks) || !item.chunks.length || item.chunks.length > 1000 || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片账本无效', 400);
    let total = 0;
    const chunks = item.chunks.map((file: string) => {
      assertPortableSourcePaths([file]); const encoded = JSON.parse(bytes(file).toString('utf8')).base64;
      if (typeof encoded !== 'string' || Buffer.from(encoded, 'base64').toString('base64') !== encoded) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片编码无效', 400);
      const decoded = Buffer.from(encoded, 'base64'); total += decoded.length;
      if (total > item.bytes) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片超出登记字节上限', 400);
      return decoded;
    });
    const reconstructed = Buffer.concat(chunks);
    if (reconstructed.length !== item.bytes || digest(reconstructed) !== item.sha256 || digest(await original(item.file)) !== item.sha256) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片不是原始提交字节', 400);
  }
  const originPath = 'src/rdesign-prepared-origin.json';
  if (files.has(originPath)) throw new DomainError('ENGINEERING_PROVENANCE', '保留的来源文件已存在', 400);
  const content = JSON.stringify({ schemaVersion: 1, kind: 'prepared-source', repositoryUrl: config.repositoryUrl, commit: config.commit, provenanceFile: config.provenanceFile,
    provenanceSha256: digest(bytes(config.provenanceFile)), preparedFileHashes: sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })), limitations: config.limitations,
    verification: '已核对账本的原始 Git 字节和适配字节；适配语义、完整捕获范围、运行与外部能力须另附证据' }, null, 2) + '\n';
  sourceFiles.push({ path: originPath, content, sha256: digest(content) });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-prepared-engineering-'));
  try {
    for (const file of sourceFiles) { const target = path.join(directory, file.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')); }
    const revision = await codeHash(directory), now = new Date().toISOString();
    const project = createProject(revision); project.name = config.name; project.scenarios = structuredClone(config.scenarios); project.scenarios.forEach(scene => { scene.status = 'unverified'; });
    const manifest: ProjectManifest = { schemaVersion: 1, id: project.id, name: config.name, kind: 'owned', template: 'blank', createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: 1, codeRevision: revision, source: { kind: 'owned', directory: 'source' } };
    const payload = { format: 'rdesign-project' as const, schemaVersion: 1 as const, manifest, document: { schemaVersion: 1 as const, project, changes: [] }, sourceFiles };
    const bundle = { ...payload, checksum: digest(JSON.stringify(payload)) };
    validatePortableProjectBundle(bundle); const preflight = preflightEngineeringBundle(bundle);
    if (!preflight.passed) throw new DomainError('ENGINEERING_PREFLIGHT', preflight.errors.join('\n'), 400);
    return bundle;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
