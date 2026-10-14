import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject, digest, DomainError } from '../../document-core/src/index.js';
import { codeHash } from '../../source-binding/src/index.js';
import { assertPortableBinaryResource, assertPortableSourcePaths, isPrivateSourceName, readPortableSourceFiles, validatePortableProjectBundle, type ProjectManifest, type PortableProjectBundle } from './index.js';
import { committedGit, preflightEngineeringBundle, type EngineeringConfig } from './engineering.js';
import { proveThemeStyleModule } from './theme-style-proof.js';
import { READER_MARKDOWN_SOURCE, READER_MARKDOWN_PREPARED, READER_PDF_SOURCES, proveReaderMarkdownFixture, proveReaderPdfFixture } from './reader-fixture-proof.js';

/** Prepared files are explicit adapter output, never executed by this packer. */
export interface PreparedEngineeringConfig extends Pick<EngineeringConfig, 'repositoryRoot' | 'repositoryUrl' | 'commit' | 'name' | 'scenarios' | 'limitations'> {
  preparedDirectory: string;
  provenanceFile: string;
  /** One unchanged theme module; ordinary portable/private path policy remains in force. */
  themeStyleModule?: { frontendDirectory: string; sourceSha256: string };
  /** One unchanged, plain short-word fixture; the generic private path rule is unchanged. */
  readerMarkdownFixture?: { sourceSha256: string };
  /** Explicit fixed-path committed reader PDF fixtures; generic binary PDFs remain excluded. */
  readerPdfFixtures?: Array<{ sourcePath: string; sourceSha256: string }>;
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
  const profile = config.themeStyleModule;
  let stylePath = '', styleProof: ReturnType<typeof proveThemeStyleModule> | undefined;
  let markdownProof: ReturnType<typeof proveReaderMarkdownFixture> | undefined;
  const pdfProofs: ReturnType<typeof proveReaderPdfFixture>[] = [];
  const markdownProfile = config.readerMarkdownFixture;
  if (markdownProfile && !/^[0-9a-f]{64}$/.test(markdownProfile.sourceSha256)) throw new DomainError('ENGINEERING_READER_FIXTURE', 'Markdown 来源摘要无效', 400);
  const pdfProfiles = config.readerPdfFixtures ?? [];
  if (!Array.isArray(pdfProfiles) || pdfProfiles.length > READER_PDF_SOURCES.size || pdfProfiles.some(item => !item || typeof item !== 'object' || typeof item.sourcePath !== 'string') || new Set(pdfProfiles.map(item => item.sourcePath)).size !== pdfProfiles.length ||
    pdfProfiles.some(item => !READER_PDF_SOURCES.has(item.sourcePath) || !/^[0-9a-f]{64}$/.test(item.sourceSha256)))
    throw new DomainError('ENGINEERING_READER_FIXTURE', 'PDF 来源配置不是限定阅读器样本', 400);
  if (profile) {
    const directory = profile.frontendDirectory;
    if (typeof directory !== 'string' || !directory || directory !== '.' && (directory.includes('\\') || directory.includes('\0') || path.posix.isAbsolute(directory) || /^[A-Za-z]:/.test(directory) || directory.split('/').some(part => !part || part === '.' || part === '..' || isPrivateSourceName(part))) || !/^[0-9a-f]{64}$/.test(profile.sourceSha256)) throw new DomainError('ENGINEERING_STYLE', '样式来源配置无效', 400);
    stylePath = (directory === '.' ? '' : directory + '/') + 'src/theme/tokens.ts';
  }
  const repository = config.repositoryUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (ledger.schemaVersion !== 1 || ledger.source?.repository !== repository || ledger.source?.commit !== config.commit || !Array.isArray(ledger.stagedFiles) || !ledger.stagedFiles.length || ledger.stagedFiles.length > 1000 || !Array.isArray(ledger.splitResources) || ledger.splitResources.length > 1000) throw new DomainError('ENGINEERING_PROVENANCE', '预备工程来源账本不匹配', 400);
  const original = async (file: string, style = false, markdown = false, pdf = false) => {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) || file.split('/').some((part, index, parts) => !part || part === '.' || part === '..' || isPrivateSourceName(part) && !((style && file === stylePath || markdown && file === READER_MARKDOWN_SOURCE) && index === parts.length - 1))) throw new DomainError('ENGINEERING_PROVENANCE', '原始文件路径无效', 400);
    const records = (await git(['ls-tree', '-z', config.commit, '--', file])).toString('utf8').split('\0').filter(Boolean);
    const record = records[0] ?? '';
    if (records.length !== 1 || !/^100(?:644|755) blob [0-9a-f]{40}\t/.test(record) || record.slice(record.indexOf('\t') + 1) !== file) throw new DomainError('ENGINEERING_PROVENANCE', '来源必须是提交中的常规文件', 400);
    if ((style || markdown || pdf) && Number((await git(['cat-file', '-s', record.split('\t')[0].split(' ')[2]])).toString('utf8').trim()) > (markdown ? 16 * 1024 : 1024 * 1024)) throw new DomainError(style ? 'ENGINEERING_STYLE' : 'ENGINEERING_READER_FIXTURE', '限定来源超出大小上限', 400);
    return git(['show', config.commit + ':' + file], markdown ? 16 * 1024 + 1 : style || pdf ? 1024 * 1024 + 1 : 24 * 1024 * 1024 + 1);
  };
  for (const item of ledger.stagedFiles) {
    assertPortableSourcePaths([item.path]);
    const style = item.sourceRole === 'theme-style-module';
    const markdown = item.sourceRole === 'reader-markdown-fixture';
    if (item.sourceRole && !style && !markdown || style && (!profile || styleProof || item.sourcePath !== stylePath || item.path !== 'src/theme/design-style.ts' || item.sourceSha256 !== profile.sourceSha256 || item.sha256 !== profile.sourceSha256)) throw new DomainError('ENGINEERING_STYLE', '样式来源角色、路径或摘要不匹配', 400);
    if (markdown && (!markdownProfile || markdownProof || item.sourcePath !== READER_MARKDOWN_SOURCE || item.path !== READER_MARKDOWN_PREPARED || item.sourceSha256 !== markdownProfile.sourceSha256 || item.sha256 !== markdownProfile.sourceSha256))
      throw new DomainError('ENGINEERING_READER_FIXTURE', 'Markdown 来源角色、路径或摘要不匹配', 400);
    const source = await original(item.sourcePath, style, markdown), adapted = bytes(item.path);
    if (!/^[0-9a-f]{64}$/.test(item.sourceSha256) || !/^[0-9a-f]{64}$/.test(item.sha256) || digest(source) !== item.sourceSha256 || digest(adapted) !== item.sha256) throw new DomainError('ENGINEERING_PROVENANCE', '原始或适配文件摘要不匹配: ' + item.path, 400);
    if (style) {
      if (!source.equals(adapted)) throw new DomainError('ENGINEERING_STYLE', '限定样式模块必须保留原始字节', 400);
      const packagePath = (profile!.frontendDirectory === '.' ? '' : profile!.frontendDirectory + '/') + 'package.json';
      const frontend = JSON.parse((await original(packagePath)).toString('utf8'));
      if (typeof frontend.dependencies?.react !== 'string' || typeof frontend.dependencies?.['react-dom'] !== 'string') throw new DomainError('ENGINEERING_STYLE', '样式来源须登记 React 前端目录', 400);
      styleProof = proveThemeStyleModule(source);
    }
    if (markdown) {
      if (!source.equals(adapted)) throw new DomainError('ENGINEERING_READER_FIXTURE', '限定 Markdown 须保留原始字节', 400);
      markdownProof = proveReaderMarkdownFixture(source);
    }
  }
  if (profile && !styleProof) throw new DomainError('ENGINEERING_STYLE', '限定样式来源没有匹配的账本记录', 400);
  if (markdownProfile && !markdownProof) throw new DomainError('ENGINEERING_READER_FIXTURE', '限定 Markdown 来源没有匹配账本', 400);
  for (const item of ledger.splitResources) {
    const pdf = item.sourceRole === 'reader-pdf-fixture';
    const pdfProfile = pdfProfiles.find(profile => profile.sourcePath === item.file);
    if (item.sourceRole && !pdf || pdf && (!pdfProfile || pdfProofs.some(proof => proof.sourcePath === item.file) || pdfProfile.sourceSha256 !== item.sha256))
      throw new DomainError('ENGINEERING_READER_FIXTURE', 'PDF 来源角色、路径或摘要不匹配', 400);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 24 * 1024 * 1024 || !Array.isArray(item.chunks) || !item.chunks.length || item.chunks.length > 1000 || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片账本无效', 400);
    if (pdf && item.bytes > 1024 * 1024) throw new DomainError('ENGINEERING_READER_FIXTURE', '限定 PDF 来源超出大小上限', 400);
    let total = 0;
    const chunks = item.chunks.map((file: string) => {
      assertPortableSourcePaths([file]); const encoded = JSON.parse(bytes(file).toString('utf8')).base64;
      if (typeof encoded !== 'string' || Buffer.from(encoded, 'base64').toString('base64') !== encoded) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片编码无效', 400);
      const decoded = Buffer.from(encoded, 'base64'); total += decoded.length;
      if (total > item.bytes) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片超出登记字节上限', 400);
      return decoded;
    });
    const reconstructed = Buffer.concat(chunks);
    if (reconstructed.length !== item.bytes || digest(reconstructed) !== item.sha256 || digest(await original(item.file, false, false, pdf)) !== item.sha256) throw new DomainError('ENGINEERING_PROVENANCE', '资源分片不是原始提交字节', 400);
    if (pdf) pdfProofs.push(proveReaderPdfFixture(item.file, reconstructed)); else assertPortableBinaryResource(item.file, reconstructed);
  }
  if (pdfProofs.length !== pdfProfiles.length) throw new DomainError('ENGINEERING_READER_FIXTURE', '限定 PDF 来源没有匹配账本', 400);
  const originPath = 'src/rdesign-prepared-origin.json';
  if (files.has(originPath)) throw new DomainError('ENGINEERING_PROVENANCE', '保留的来源文件已存在', 400);
  const content = JSON.stringify({ schemaVersion: 1, kind: 'prepared-source', repositoryUrl: config.repositoryUrl, commit: config.commit, provenanceFile: config.provenanceFile,
    provenanceSha256: digest(bytes(config.provenanceFile)), preparedFileHashes: sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })), limitations: config.limitations,
    ...(styleProof ? { themeStyleModuleProof: { ...styleProof, sourcePath: stylePath, preparedPath: 'src/theme/design-style.ts' } } : {}),
    ...(markdownProof ? { readerMarkdownFixtureProof: { ...markdownProof, sourcePath: READER_MARKDOWN_SOURCE, preparedPath: READER_MARKDOWN_PREPARED } } : {}),
    ...(pdfProofs.length ? { readerPdfFixtureProofs: pdfProofs } : {}),
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
