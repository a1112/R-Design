import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, realpath, rename, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Project, ChangeSet, RuntimeFrame, ProjectSummary as SharedProjectSummary, EngineeringBundle } from '../../protocol/src/index.js';
import { createProject, digest, DomainError } from '../../document-core/src/index.js';
import { codeHash } from '../../source-binding/src/index.js';

export type ProjectTemplate = 'blank' | 'react-monitor';
export interface ProjectSummary extends SharedProjectSummary { template: ProjectTemplate; lastOpenedAt: string }
export interface ProjectManifest extends Omit<ProjectSummary, 'location'> {
  schemaVersion: 1; source: { kind: 'owned' | 'linked'; directory: string };
}
export interface PortableProjectDocument { schemaVersion: 1; project: Project; changes: ChangeSet[] }
export interface PortableProjectBundle extends Omit<EngineeringBundle, 'manifest' | 'sourceFiles'> {
  format: 'rdesign-project'; schemaVersion: 1; manifest: ProjectManifest;
  document: PortableProjectDocument; sourceFiles: Array<{ path: string; content: string; sha256: string; encoding?: 'utf8' | 'base64' }>; checksum: string;
}
export interface CatalogWriteEnvelope { operationId: string; expectedRevision: number }
interface Operation { fingerprint: string; status: 'pending' | 'completed' | 'failed'; result?: unknown; revision: number; error?: { code: string; message: string; status: number; retryable: boolean } }
interface Registry { schemaVersion: 1; revision: number; activeProjectId: string; projects: ProjectManifest[]; operations: Record<string, Operation> }
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 24 * MAX_FILE_BYTES;
const MAX_SOURCE_FILES = 1000;
const ID = /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OMIT_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.rdesign', '.next']);
const SECRET_NAME = /(?:^\.|(?:^|[._-])(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)|\.(?:pem|key|crt|p12|pfx|keystore)$)/i;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|svg|html|txt|md|xml|yaml|yml)$/i;
const BINARY_EXTENSION = /\.(?:png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;
const EXECUTABLE_CONFIG = /^(?:vite|vitest|webpack|rollup|next|nuxt|babel|eslint|postcss|tailwind)\.config\.|^(?:\.npmrc|\.yarnrc|Makefile|Dockerfile)$/i;
const CREDENTIAL = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,})\b|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'](?!fixture|demo|example|test|placeholder|your[_-]|\$\{|process\.env)[A-Za-z0-9_+/=-]{16,}["']/i;
const PACKAGE = { name: '@rdesign/project', version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, dependencies: { '@rdesign/runtime-web': '*', react: '^19.1.0', 'react-dom': '^19.1.0' } };
const VITE_CONFIG = "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport { rdesignSourceIds } from '@rdesign/runtime-web/vite';\nexport default defineConfig({ plugins: [rdesignSourceIds(), react()], server: { host: '127.0.0.1' } });\n";
const HTML = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>R-Design 项目</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n';
const BLANK_MAIN = `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installRuntime } from '@rdesign/runtime-web';

function App() {
  const [count, setCount] = useState(0);
  return <main data-rdesign-id="blank-canvas" data-rdesign-ready="true" style={{ minHeight: '100vh', backgroundColor: '#f4f6f8', padding: 48, color: '#142338', fontFamily: 'system-ui' }}>
    <section data-rdesign-id="welcome-card" style={{ backgroundColor: '#ffffff', borderRadius: 24, padding: 40, maxWidth: 600 }}>
      <p data-rdesign-id="project-label" style={{ color: '#6b7280', fontSize: 13, letterSpacing: 2 }}>R-DESIGN / YOUR NEXT IDEA</p>
      <h1 data-rdesign-id="welcome-title" style={{ fontSize: 40, color: '#142338', margin: 0 }}>从一个想法开始</h1>
      <p data-rdesign-id="welcome-description" style={{ fontSize: 16, color: '#64748b', lineHeight: 1.8 }}>选中元素，调整属性，或给 AI 写一条批注。</p>
      <button data-rdesign-id="start-button" style={{ borderRadius: 12, padding: 16, fontSize: 15, color: '#ffffff', backgroundColor: '#196ee6' }} onClick={() => setCount(value => value + 1)}>开始创作</button>
      <p data-rdesign-id="click-counter" style={{ color: '#64748b', fontSize: 13 }} role="status">已点击 {count} 次</p>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
if (import.meta.env.DEV || import.meta.env.VITE_RDESIGN_RUNTIME === 'true') installRuntime();
`;

function validName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f]/.test(value)) throw new DomainError('PROJECT_NAME_INVALID', '项目名称须为 1–100 个可显示字符', 400);
  return value.trim();
}
function portablePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 300 || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || SECRET_NAME.test(part) || OMIT_NAMES.has(part))) throw new DomainError('IMPORT_PATH', '项目文件路径无效或包含私密文件', 400);
  if (value.split('/').some(part => EXECUTABLE_CONFIG.test(part))) throw new DomainError('IMPORT_CONFIG', '禁止导入可执行工具配置', 400);
  if (!(value === 'index.html' || value === 'package.json' || /^(?:src|assets|public)\//.test(value)) || !(SOURCE_EXTENSION.test(value) || BINARY_EXTENSION.test(value))) throw new DomainError('IMPORT_CONFIG', '导入仅允许应用源码与静态资产，禁止可执行工具配置', 400);
  return value;
}
const portableKey=(value:string)=>value.normalize('NFC').toLowerCase();
/** Reject filesystem aliases and file/directory overlaps before allocating an imported project. */
function assertPortableLayout(paths:string[]){
  const entries=new Map<string,{path:string;kind:'file'|'directory'}>();
  for(const file of paths){portablePath(file);const parts=file.split('/');for(let length=1;length<parts.length;length++){const directory=parts.slice(0,length).join('/');const key=portableKey(directory);const previous=entries.get(key);if(previous&&(previous.kind==='file'||previous.path!==directory))throw new DomainError('IMPORT_PATH','工程文件路径归一化后重叠或目录别名冲突',400);entries.set(key,{path:directory,kind:'directory'});}const key=portableKey(file);if(entries.has(key))throw new DomainError('IMPORT_PATH','工程文件路径归一化后重复或与目录重叠',400);entries.set(key,{path:file,kind:'file'});}
}
function validateSource(file: string, content: unknown): string {
  portablePath(file);
  if (BINARY_EXTENSION.test(file)) throw new DomainError('IMPORT_FILE', '二进制资产必须声明 base64 编码', 400);
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES || content.includes('\0') || content.includes('\ufffd')) throw new DomainError('IMPORT_FILE', '文件必须是最多 1 MiB 的 UTF-8 文本', 400);
  if (CREDENTIAL.test(content)) throw new DomainError('IMPORT_SECRET', '项目文件包含私密凭据，请先移除凭据', 400);
  if (file === 'package.json') {
    let config: any; try { config = JSON.parse(content); } catch { throw new DomainError('IMPORT_CONFIG', '无效 package.json', 400); }
    const scripts = config.scripts ?? {};
    if (Object.entries(scripts).some(([key, value]) => !['dev', 'build'].includes(key) || typeof value !== 'string' || !/^vite(?: build)?(?: --host 127\.0\.0\.1)?(?: --port \d+)?$/.test(value)) || config.bin || config.workspaces || config.packageManager || config.overrides || config.resolutions) throw new DomainError('IMPORT_CONFIG', '项目包配置包含未授权的执行入口', 400);
    for (const dependencies of [config.dependencies, config.devDependencies, config.optionalDependencies]) for (const [name, version] of Object.entries(dependencies ?? {})) if (!['react', 'react-dom', '@rdesign/runtime-web', 'vite', '@vitejs/plugin-react', 'typescript', '@types/react', '@types/react-dom'].includes(name) || typeof version !== 'string' || !/^(?:\*|[\^~]?[0-9]+(?:\.[0-9x*]+){0,2})$/.test(version)) throw new DomainError('IMPORT_CONFIG', '仅允许受支持的 React 工程依赖', 400);
  }
  return content;
}
function binaryFile(file: string, content: unknown): Buffer {
  portablePath(file);
  if (!BINARY_EXTENSION.test(file) || typeof content !== 'string' || content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new DomainError('IMPORT_FILE', '二进制资产编码或类型无效', 400);
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== content) throw new DomainError('IMPORT_FILE', '二进制资产须为最多 1 MiB 的规范 base64', 400);
  const extension = path.extname(file).toLowerCase();
  const prefix = bytes.subarray(0, 12); const ascii = prefix.toString('ascii');
  const valid = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['.jpg', '.jpeg'].includes(extension) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : extension === '.webp' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
    : extension === '.gif' ? /^(?:GIF87a|GIF89a)/.test(ascii)
    : extension === '.avif' ? ascii.slice(4, 8) === 'ftyp' && /(?:avif|avis)/.test(bytes.subarray(8, Math.min(bytes.length, 40)).toString('ascii'))
    : extension === '.ico' ? prefix.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
    : extension === '.woff' ? ascii.startsWith('wOFF')
    : extension === '.woff2' ? ascii.startsWith('wOF2')
    : extension === '.ttf' ? prefix.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) || ascii.startsWith('true')
    : extension === '.otf' && ascii.startsWith('OTTO');
  if (!valid) throw new DomainError('IMPORT_FILE', '二进制资产内容与文件类型不匹配', 400);
  return bytes;
}
function fileBytes(file: PortableProjectBundle['sourceFiles'][number]): string | Buffer {
  if (file.encoding !== undefined && !['utf8', 'base64'].includes(file.encoding)) throw new DomainError('IMPORT_FILE', '不支持的工程文件编码', 400);
  return file.encoding === 'base64' ? binaryFile(file.path, file.content) : validateSource(file.path, file.content);
}
function assertDocument(value: unknown): asserts value is PortableProjectDocument {
  if (!value || typeof value !== 'object' || (value as any).schemaVersion !== 1) throw new DomainError('IMPORT_SCHEMA', '无效工程文档', 400);
  const project = (value as PortableProjectDocument).project;
  if (!project || !ID.test(project.id) || !Number.isSafeInteger(project.revision) || project.revision < 1 || typeof project.codeRevision !== 'string' || !['annotations', 'snapshots', 'scenarios', 'assets', 'designFrames'].every(key => Array.isArray((project as any)[key])) || !Array.isArray((value as any).changes)) throw new DomainError('IMPORT_SCHEMA', '工程文档缺少必填集合', 400);
  validName(project.name);
  const identity = (id: unknown) => typeof id === 'string' && /^[-A-Za-z0-9_:]{1,128}$/.test(id);
  const bounds = (box: any) => box && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(box[key])) && box.w >= 0 && box.h >= 0;
  const version = (item: any) => item && typeof item.runtimeSessionId === 'string' && typeof item.surfaceId === 'string' && typeof item.codeRevision === 'string' && ['epoch', 'treeRevision', 'viewportRevision', 'geometryRevision'].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0);
  const frame = (item: RuntimeFrame) => {
    if (!item || !identity(item.id) || !version(item) || typeof item.timestamp !== 'string' || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 16384 || item.height > 16384 || !Array.isArray(item.nodes) || item.nodes.length > 20000 || typeof item.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]*$/.test(item.image)) throw new DomainError('IMPORT_SNAPSHOT', '无效截图数据', 400);
    for (const node of item.nodes) { if (!node || !identity(node.runtimeNodeId) || !bounds(node.bounds) || typeof node.text !== 'string' || !node.styles || typeof node.styles !== 'object') throw new DomainError('IMPORT_SNAPSHOT', '无效截图节点数据', 400); if (node.binding) portablePath(node.binding.file); }
  };
  for (const asset of project.assets) if (!asset || !identity(asset.id) || typeof asset.name !== 'string' || !asset.provenance || typeof asset.url !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]*$/.test(asset.url)) throw new DomainError('IMPORT_ASSET', '仅允许内嵌静态图像资产', 400);
  for (const snapshot of project.snapshots) frame(snapshot);
  for (const annotation of project.annotations) {
    if (!annotation || !identity(annotation.id) || typeof annotation.text !== 'string' || !annotation.anchor || !identity(annotation.anchor.frameId) || !bounds(annotation.anchor.bounds) || !version(annotation.anchor.version) || !Array.isArray(annotation.strokes)) throw new DomainError('IMPORT_SCHEMA', '无效批注数据', 400);
    for (const stroke of annotation.strokes) if (!stroke || !identity(stroke.id) || !Array.isArray(stroke.points) || typeof stroke.color !== 'string' || !Number.isFinite(stroke.width) || stroke.points.some(point => !point || ![point.x, point.y, point.pressure, point.time].every(Number.isFinite))) throw new DomainError('IMPORT_SCHEMA', '无效笔迹数据', 400);
  }
  for (const design of project.designFrames) if (!design || !identity(design.id) || typeof design.name !== 'string' || !Array.isArray(design.nodes) || design.nodes.some(node => !node || !identity(node.id) || !['text', 'rectangle'].includes(node.type) || !bounds(node.bounds) || typeof node.color !== 'string')) throw new DomainError('IMPORT_SCHEMA', '无效设计画板', 400);
  for (const scenario of project.scenarios) {
    if (!scenario || !identity(scenario.id) || typeof scenario.name !== 'string' || typeof scenario.readySelector !== 'string' || !scenario.viewport || !Number.isSafeInteger(scenario.viewport.width) || !Number.isSafeInteger(scenario.viewport.height) || scenario.viewport.width < 1 || scenario.viewport.height < 1 || !Array.isArray(scenario.steps) || scenario.steps.some(step => !step || !['click', 'fill'].includes(step.action) || typeof step.target !== 'string') || typeof scenario.route !== 'string' || !scenario.route.startsWith('/') || scenario.route.startsWith('//') || scenario.route.includes('\\') || !Array.isArray(scenario.dependencies)) throw new DomainError('IMPORT_PATH', '场景路径或参数无效', 400);
    for (const file of scenario.dependencies) if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('\\') || file.includes('\0') || file.split('/').includes('..')) throw new DomainError('IMPORT_PATH', '场景依赖路径越界', 400);
  }
  for (const change of (value as PortableProjectDocument).changes) {
    if (!change || typeof change.id !== 'string' || !Array.isArray(change.patches) || !Array.isArray(change.evidence)) throw new DomainError('IMPORT_SCHEMA', '变更记录无效', 400);
    for (const patch of change.patches) { portablePath(patch.file); validateSource(patch.file, patch.before); validateSource(patch.file, patch.after); }
    if (change.candidateFrame) frame(change.candidateFrame);
    for (const evidence of change.evidence) { if (!evidence || typeof evidence.name !== 'string' || typeof evidence.passed !== 'boolean' || typeof evidence.detail !== 'string') throw new DomainError('IMPORT_SCHEMA', '变更证据无效', 400); if (evidence.snapshot) frame(evidence.snapshot); }
  }
  const visit = (object: unknown, depth = 0) => {
    if (depth > 80) throw new DomainError('IMPORT_SCHEMA', '工程文档嵌套过深', 400);
    if (Array.isArray(object)) { object.forEach(item => visit(item, depth + 1)); return; }
    if (object && typeof object === 'object') for (const [key, item] of Object.entries(object)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new DomainError('IMPORT_SCHEMA', '文档包含不安全字段', 400); visit(item, depth + 1); }
  }; visit(value);
}

export class ProjectWorkspace {
  private state!: Registry;
  private queue: Promise<unknown> = Promise.resolve();
  private persistenceQueue: Promise<unknown> = Promise.resolve();
  private dirty = false;
  private mutationDepth = 0;
  readonly rootDataRoot: string;
  readonly legacyWorkspace: string;
  readonly repoRoot: string;
  constructor(rootDataRoot: string, legacyWorkspace: string, repoRoot: string) {
    this.rootDataRoot = path.resolve(rootDataRoot); this.legacyWorkspace = path.resolve(legacyWorkspace); this.repoRoot = path.resolve(repoRoot);
  }
  get catalog() { return { revision: this.state.revision, activeProjectId: this.state.activeProjectId, projects: this.state.projects.map(manifest => this.summary(manifest)), canManage: true as const }; }
  get health() { return { writable: !this.dirty, pendingOperations: Object.entries(this.state.operations).filter(([, operation]) => operation.status === 'pending').map(([id]) => id) }; }
  private summary(manifest: ProjectManifest): ProjectSummary {
    const { schemaVersion, source, ...metadata } = manifest;
    return { ...structuredClone(metadata), location: source.kind === 'linked' ? this.legacyWorkspace : path.join(this.projectDirectory(manifest.id), 'source') };
  }
  private projectDirectory(id: string) {
    if (!ID.test(id)) throw new DomainError('PROJECT_ID_INVALID', '无效项目身份', 400);
    return path.join(this.rootDataRoot, 'projects', id.slice('project_'.length));
  }
  get(id: string) {
    const manifest = this.state.projects.find(project => project.id === id);
    if (!manifest) throw new DomainError('PROJECT_NOT_FOUND', '项目不存在', 404);
    const directory = manifest.kind === 'linked' ? this.rootDataRoot : this.projectDirectory(id);
    return { summary: this.summary(manifest), manifest: structuredClone(manifest), directory, dataDirectory: manifest.kind === 'linked' ? this.rootDataRoot : path.join(directory, '.rdesign'), sourceDirectory: manifest.kind === 'linked' ? this.legacyWorkspace : path.join(directory, 'source') };
  }
  /** Re-check filesystem ownership immediately before a caller opens project data. */
  async validate(id: string): Promise<ReturnType<ProjectWorkspace['get']>> {
    const entry = this.get(id);
    for (const directory of [entry.directory, entry.dataDirectory, entry.sourceDirectory]) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程目录不允许符号链接', 403);
      if (directory !== this.legacyWorkspace) await this.safeDirectory(directory);
    }
    for (const file of [path.join(entry.dataDirectory, 'project.json'), path.join(entry.directory, 'rdesign.project.json')]) {
      try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程文档须为常规文件且不允许符号链接', 403); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (path.basename(file) === 'project.json') throw new DomainError('PROJECT_DOCUMENT_MISSING', '工程文档已丢失，请恢复文件后再打开', 409); }
    }
    return entry;
  }
  private async safeDirectory(directory: string) {
    const rootStat = await lstat(this.rootDataRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '数据根目录不允许符号链接', 403);
    const relative = path.relative(this.rootDataRoot, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程目录越界', 403);
    const base = await realpath(this.rootDataRoot);
    let current = this.rootDataRoot;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程目录不允许符号链接', 403); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(current); }
      const actual = await realpath(current); if (actual !== base && !actual.startsWith(base + path.sep)) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程目录越界', 403);
    }
  }
  private async atomic(file: string, content: string | Buffer) {
    await this.safeDirectory(path.dirname(file));
    try { if ((await lstat(file)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '工程文件不允许符号链接', 403); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; }
    const directory = await open(path.dirname(file), 'r'); try { await directory.sync(); } finally { await directory.close(); }
  }
  async load(legacyProject: Project): Promise<this> {
    await mkdir(this.rootDataRoot, { recursive: true });
    if ((await lstat(this.rootDataRoot)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '数据根目录不允许符号链接', 403);
    if ((await lstat(this.legacyWorkspace)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '源码根目录不允许符号链接', 403);
    try {
      const file = path.join(this.rootDataRoot, 'workspace.json');
      if ((await lstat(file)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '项目注册表不允许符号链接', 403);
      this.state = JSON.parse(await readFile(file, 'utf8'));
      if (this.state.schemaVersion !== 1 || !Number.isSafeInteger(this.state.revision) || !Array.isArray(this.state.projects) || !this.state.operations || typeof this.state.operations !== 'object') throw new DomainError('PROJECT_REGISTRY_INVALID', '无效项目注册表', 400);
      const ids = new Set<string>();
      for (const manifest of this.state.projects) {
        if (!ID.test(manifest.id) || ids.has(manifest.id) || manifest.schemaVersion !== 1 || !['owned', 'linked'].includes(manifest.kind) || manifest.source?.kind !== manifest.kind || (manifest.kind === 'linked' && manifest.source.directory !== this.legacyWorkspace) || (manifest.kind === 'owned' && manifest.source.directory !== 'source')) throw new DomainError('PROJECT_REGISTRY_INVALID', '项目注册表身份或路径无效', 400);
        ids.add(manifest.id); validName(manifest.name);
        if (manifest.kind === 'owned') { const entry = this.get(manifest.id); await this.safeDirectory(entry.directory); await this.safeDirectory(entry.sourceDirectory); await this.safeDirectory(entry.dataDirectory); }
      }
      if (!ids.has(this.state.activeProjectId) || this.state.projects.find(project => project.id === this.state.activeProjectId)?.archived) {const fallback=this.state.projects.find(project=>project.id===legacyProject.id&&!project.archived)??this.state.projects.find(project=>!project.archived);if(!fallback)throw new DomainError('PROJECT_REGISTRY_INVALID','没有可恢复的非归档工程',400);this.state.activeProjectId=fallback.id;await this.save();}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const now = new Date().toISOString();
      if (!ID.test(legacyProject.id)) throw new DomainError('PROJECT_ID_INVALID', '原有项目身份无效', 400);
      const legacy: ProjectManifest = { schemaVersion: 1, id: legacyProject.id, name: legacyProject.name, kind: 'linked', template: 'react-monitor', createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: legacyProject.revision, codeRevision: legacyProject.codeRevision, source: { kind: 'linked', directory: this.legacyWorkspace } };
      this.state = { schemaVersion: 1, revision: 1, activeProjectId: legacy.id, projects: [legacy], operations: Object.create(null) }; await this.save();
    }
    return this;
  }
  async save() {
    const persist = this.persistenceQueue.then(async () => {
      const snapshot = structuredClone(this.state);
      for (const manifest of snapshot.projects) await this.atomic(path.join(manifest.kind === 'linked' ? this.rootDataRoot : this.projectDirectory(manifest.id), 'rdesign.project.json'), JSON.stringify(manifest, null, 2));
      await this.atomic(path.join(this.rootDataRoot, 'workspace.json'), JSON.stringify(snapshot, null, 2)); this.dirty = false;
    }); this.persistenceQueue = persist.catch(() => {}); await persist;
  }
  private async completeMutation<T>(result: T): Promise<T> { if (!this.mutationDepth) { this.state.revision += 1; await this.save(); } return result; }
  async write<T>(envelope: CatalogWriteEnvelope, fingerprint: string, mutation: () => T | Promise<T>): Promise<T> {
    const persist = async () => { try { await this.save(); } catch { this.dirty = true; throw new DomainError('STORE_SAVE_FAILED', '项目操作收据无法持久化，请用同一 operationId 重试', 503, true); } };
    const run = this.queue.then(async () => {
      if (this.dirty) await persist();
      const operation = envelope && Object.hasOwn(this.state.operations, envelope.operationId) ? this.state.operations[envelope.operationId] : undefined;
      if (operation) {
        if (operation.fingerprint !== fingerprint) throw new DomainError('OPERATION_COLLISION', '相同 operationId 对应不同项目操作', 409);
        if (operation.status === 'pending') throw new DomainError('OPERATION_OUTCOME_UNKNOWN', '服务在项目操作确认前中断，不能自动重复执行', 409);
        if (operation.status === 'failed' && operation.error) throw new DomainError(operation.error.code, operation.error.message, operation.error.status, operation.error.retryable);
        return operation.result as T;
      }
      if (!envelope || !Number.isSafeInteger(envelope.expectedRevision) || envelope.expectedRevision !== this.state.revision) throw new DomainError('REVISION_CONFLICT', `项目目录已更新，请刷新至版本 ${this.state.revision}`, 409);
      if (typeof envelope.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(envelope.operationId)) throw new DomainError('INVALID_OPERATION_ID', 'operationId 必须是 8–128 位字母、数字、短横线或下划线', 400);
      const backup = JSON.stringify(this.state);
      this.state.operations[envelope.operationId] = { fingerprint, status: 'pending', revision: this.state.revision };
      try { await this.save(); } catch { this.state = JSON.parse(backup); this.dirty = false; throw new DomainError('STORE_SAVE_FAILED', '无法保存项目操作开始记录，尚未执行该操作', 503, true); }
      let result: T;
      try { this.mutationDepth++; result = await mutation(); }
      catch (error) {
        this.state = JSON.parse(backup); const failure = error as DomainError;
        this.state.operations[envelope.operationId] = { fingerprint, status: 'failed', revision: this.state.revision, error: { code: failure.code ?? 'MUTATION_FAILED', message: failure.message, status: failure.status ?? 400, retryable: failure.retryable ?? false } };
        await persist(); throw error;
      } finally { this.mutationDepth--; }
      this.state.revision++; this.state.operations[envelope.operationId] = { fingerprint, status: 'completed', result, revision: this.state.revision }; await persist(); return result;
    }); this.queue = run.catch(() => {}); return run;
  }
  private async template(directory: string, template: ProjectTemplate) {
    await this.safeDirectory(directory); await this.safeDirectory(path.join(directory, 'src'));
    if (template === 'react-monitor') {
      const source = path.join(this.repoRoot, 'fixtures', 'react-monitor');
      for (const file of await this.sourceBundle(source)) await this.atomic(path.join(directory, file.path), fileBytes(file));
    } else { await this.atomic(path.join(directory, 'src/main.tsx'), BLANK_MAIN); await this.atomic(path.join(directory, 'index.html'), HTML); }
    await this.atomic(path.join(directory, 'package.json'), JSON.stringify(PACKAGE, null, 2) + '\n');
    await this.atomic(path.join(directory, 'vite.config.ts'), VITE_CONFIG);
    await this.atomic(path.join(directory, 'src/vite-env.d.ts'), '/// <reference types="vite/client" />\n');
    await this.atomic(path.join(directory, 'src/runtime-module.d.ts'), "declare module '@rdesign/runtime-web';\n");
  }
  async create(name: string, template: ProjectTemplate): Promise<ProjectSummary> {
    name = validName(name); if (!['blank', 'react-monitor'].includes(template)) throw new DomainError('PROJECT_TEMPLATE_INVALID', '不支持的项目模板', 400);
    const id = `project_${randomUUID()}`; const directory = this.projectDirectory(id); const source = path.join(directory, 'source');
    await this.template(source, template); const revision = await codeHash(source); const now = new Date().toISOString();
    const manifest: ProjectManifest = { schemaVersion: 1, id, name, kind: 'owned', template, createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: 1, codeRevision: revision, source: { kind: 'owned', directory: 'source' } };
    const project = createProject(revision); project.id = id; project.name = name;
    if (template === 'blank') project.scenarios = project.scenarios.filter(scenario => scenario.id !== 'settings').map(scenario => ({ ...scenario, name: scenario.id === 'overview-desktop' ? '首页 · 桌面' : '首页 · 窄屏' }));
    await this.atomic(path.join(directory, '.rdesign/project.json'), JSON.stringify({ schemaVersion: 1, project, changes: [], operations: {} }, null, 2));
    this.state.projects.push(manifest); return this.completeMutation(this.summary(manifest));
  }
  async update(id: string, patch: { name?: string; favorite?: boolean; archived?: boolean }): Promise<ProjectSummary> {
    await this.validate(id); const manifest = this.state.projects.find(project => project.id === id)!;
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['name', 'favorite', 'archived'].includes(key))) throw new DomainError('PROJECT_UPDATE_INVALID', '无效项目更新', 400);
    if (patch.name !== undefined) validName(patch.name);
    for (const key of ['favorite', 'archived'] as const) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new DomainError('PROJECT_UPDATE_INVALID', '收藏与归档状态须为布尔值', 400);
    if (patch.archived && id === this.state.activeProjectId) throw new DomainError('PROJECT_ACTIVE', '请先打开另一项目再归档当前项目', 409);
    if (patch.name !== undefined) manifest.name = validName(patch.name);
    if (patch.favorite !== undefined) manifest.favorite = patch.favorite;
    if (patch.archived !== undefined) manifest.archived = patch.archived;
    manifest.updatedAt = new Date().toISOString(); return this.completeMutation(this.summary(manifest));
  }
  async setActive(id: string): Promise<ProjectSummary> {
    const entry = await this.validate(id); if (entry.manifest.archived) throw new DomainError('PROJECT_ARCHIVED', '请先恢复已归档项目', 409);
    const manifest = this.state.projects.find(project => project.id === id)!; manifest.lastOpenedAt = new Date().toISOString(); this.state.activeProjectId = id;
    return this.completeMutation(this.summary(manifest));
  }
  /** Refresh metadata from a loaded document without changing catalog identity or version. */
  async refresh(id: string, project: Project, frame?: RuntimeFrame | null): Promise<void> {
    await this.validate(id); if (project.id !== id) throw new DomainError('PROJECT_MISMATCH', '工程文档身份不匹配', 400);
    const manifest = this.state.projects.find(entry => entry.id === id)!;
    manifest.documentRevision = project.revision; manifest.codeRevision = project.codeRevision; manifest.updatedAt = new Date().toISOString();
    manifest.frameCount = project.designFrames.length + project.snapshots.length; manifest.assetCount = project.assets.length;
    try { const stored = JSON.parse(await readFile(path.join(this.get(id).dataDirectory, 'project.json'), 'utf8')); if (Array.isArray(stored.changes)) manifest.changeCount = stored.changes.length; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const thumbnail = frame?.image ?? project.snapshots.at(-1)?.image;
    if (thumbnail && thumbnail.length <= 256 * 1024 && /^data:image\/png;base64,/.test(thumbnail)) manifest.thumbnail = thumbnail;
    await this.save();
  }
  async syncDocument(project: Project): Promise<void> { await this.refresh(project.id, project); }
  private async sourceBundle(root: string): Promise<PortableProjectBundle['sourceFiles']> {
    const actualRoot = await realpath(root); if ((await lstat(root)).isSymbolicLink()) throw new DomainError('PROJECT_PATH_FORBIDDEN', '源码根目录不允许符号链接', 403);
    const files: PortableProjectBundle['sourceFiles'] = []; let total = 0;
    const visit = async (directory: string) => {
      for (const name of (await readdir(path.join(root, directory))).sort()) {
        if (OMIT_NAMES.has(name) || SECRET_NAME.test(name)) continue;
        const relative = directory ? `${directory}/${name}` : name; const absolute = path.join(root, relative); const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) continue;
        const resolved = await realpath(absolute); if (!resolved.startsWith(actualRoot + path.sep)) throw new DomainError('PROJECT_PATH_FORBIDDEN', '源码文件越界', 403);
        if (stat.isDirectory()) { if (directory || ['src', 'assets', 'public'].includes(name)) await visit(relative); continue; }
        if (!stat.isFile() || EXECUTABLE_CONFIG.test(name) || !(SOURCE_EXTENSION.test(relative) || BINARY_EXTENSION.test(relative)) || (!directory && !['index.html', 'package.json'].includes(name))) continue;
        if (stat.size > MAX_FILE_BYTES) throw new DomainError('EXPORT_FILE_TOO_LARGE', `${relative} 超过 1 MiB 文件上限`, 400);
        const buffer = await readFile(absolute); const binary = BINARY_EXTENSION.test(relative);
        const content = binary ? buffer.toString('base64') : validateSource(relative, buffer.toString('utf8'));
        if (binary) binaryFile(relative, content);
        total += buffer.length; if (total > MAX_BUNDLE_BYTES || files.length >= MAX_SOURCE_FILES) throw new DomainError('EXPORT_TOO_LARGE', '工程源文件超出便携包上限', 400);
        files.push({ path: relative, content, sha256: digest(buffer), ...(binary ? { encoding: 'base64' as const } : {}) });
      }
    }; await visit('');assertPortableLayout(files.map(file=>file.path));return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  async export(id: string, document: PortableProjectDocument): Promise<PortableProjectBundle> {
    const entry = await this.validate(id); assertDocument(document);
    if (document.project.id !== id) throw new DomainError('PROJECT_MISMATCH', '导出文档身份不匹配', 400);
    const sourceFiles = await this.sourceBundle(entry.sourceDirectory);
    const manifest = { ...entry.manifest, source: { kind: 'owned' as const, directory: 'source' }, kind: 'owned' as const, documentRevision: document.project.revision, codeRevision: document.project.codeRevision };
    const portable = { format: 'rdesign-project' as const, schemaVersion: 1 as const, manifest, document: structuredClone(document), sourceFiles };
    if (Buffer.byteLength(JSON.stringify(portable)) > MAX_BUNDLE_BYTES) throw new DomainError('EXPORT_TOO_LARGE', '工程源文件与证据超出便携包上限', 400);
    return { ...portable, checksum: digest(JSON.stringify(portable)) };
  }
  async import(bundle: unknown): Promise<ProjectSummary> {
    if (!bundle || typeof bundle !== 'object' || (bundle as any).format !== 'rdesign-project' || (bundle as any).schemaVersion !== 1) throw new DomainError('IMPORT_SCHEMA', '不支持的工程便携包', 400);
    const incoming = bundle as PortableProjectBundle;
    if (!incoming.manifest || incoming.manifest.schemaVersion !== 1 || !Array.isArray(incoming.sourceFiles) || !incoming.sourceFiles.length || incoming.sourceFiles.length > MAX_SOURCE_FILES || typeof incoming.checksum !== 'string') throw new DomainError('IMPORT_SCHEMA', '工程便携包缺少必填字段', 400);
    const { checksum, ...payload } = incoming;
    const encoded = JSON.stringify(payload); if (Buffer.byteLength(encoded) > MAX_BUNDLE_BYTES) throw new DomainError('IMPORT_TOO_LARGE', '工程便携包超出大小上限', 400);
    if (digest(encoded) !== checksum) throw new DomainError('IMPORT_INTEGRITY', '工程便携包校验失败', 400);
    assertDocument(incoming.document); const name = validName(incoming.manifest.name); const template = incoming.manifest.template;
    if (!['blank', 'react-monitor'].includes(template)) throw new DomainError('PROJECT_TEMPLATE_INVALID', '不支持的项目模板', 400);
    const paths=incoming.sourceFiles.map(file=>{if(!file||typeof file.path!=='string')throw new DomainError('IMPORT_PATH','工程文件路径无效',400);return file.path;});assertPortableLayout(paths);
    const names = new Set<string>();
    for (const file of incoming.sourceFiles) {
      if (!file || typeof file.path !== 'string' || names.has(portableKey(file.path))) throw new DomainError('IMPORT_PATH', '工程文件路径重复或无效', 400);
      const bytes = fileBytes(file); if (digest(bytes) !== file.sha256) throw new DomainError('IMPORT_INTEGRITY', '工程源文件校验失败', 400); names.add(portableKey(file.path));
    }
    if (!names.has('index.html') || !names.has('src/main.tsx')) throw new DomainError('IMPORT_SOURCE', '工程缺少 index.html 或 src/main.tsx 入口', 400);
    const id = `project_${randomUUID()}`; const directory = this.projectDirectory(id); const source = path.join(directory, 'source');
    await this.safeDirectory(source);
    for (const file of incoming.sourceFiles) await this.atomic(path.join(source, file.path), fileBytes(file));
    await this.atomic(path.join(source, 'package.json'), JSON.stringify(PACKAGE, null, 2) + '\n'); await this.atomic(path.join(source, 'vite.config.ts'), VITE_CONFIG);
    await this.atomic(path.join(source, 'src/runtime-module.d.ts'), "declare module '@rdesign/runtime-web';\n");
    const revision = await codeHash(source); const now = new Date().toISOString();
    const document = structuredClone(incoming.document); const formerId = document.project.id;
    const changeIds = new Map(document.changes.map(change => [change.id, `change_${randomUUID()}`]));
    const remap = (value: any, key?: string): any => {
      if (Array.isArray(value)) return value.map(item => remap(item));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, remap(item, field)]));
      if (typeof value === 'string') { if (key === 'projectId' || (value === formerId && (key === 'id' || key === 'activeProjectId'))) return id; if (changeIds.has(value) && ['id', 'changeId', 'changeSetId', 'candidateId'].includes(key ?? '')) return changeIds.get(value); }
      return value;
    };
    const remapped = remap(document) as PortableProjectDocument; remapped.project.id = id; remapped.project.name = name; remapped.project.revision = 1; remapped.project.codeRevision = revision;
    remapped.project.scenarios.forEach(scenario => { scenario.status = 'unverified'; });
    for (const annotation of remapped.project.annotations) annotation.projectId = id;
    for (const change of remapped.changes) { change.projectId = id; change.operationId = `import_${randomUUID()}`; change.expectedRevision = 1; change.status = 'discarded'; change.error = '导入的历史记录只读，候选须在新项目中重新生成与验证'; }
    for (const asset of remapped.project.assets) {
      const bytes = Buffer.from(asset.url.split(',')[1], 'base64'); asset.hash = digest(bytes);
      const extension = /^data:image\/jpeg;/.test(asset.url) ? 'jpeg' : /^data:image\/webp;/.test(asset.url) ? 'webp' : 'png';
      await this.atomic(path.join(directory, '.rdesign/blobs', `${asset.hash}.${extension}`), bytes);
    }
    for (const snapshot of remapped.project.snapshots) {
      const bytes = Buffer.from(snapshot.image.split(',')[1], 'base64');
      await this.atomic(path.join(directory, '.rdesign/blobs', `${digest(bytes)}.png`), bytes);
    }
    const manifest: ProjectManifest = { schemaVersion: 1, id, name, kind: 'owned', template, createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: 1, codeRevision: revision, source: { kind: 'owned', directory: 'source' } };
    await this.atomic(path.join(directory, '.rdesign/project.json'), JSON.stringify({ ...remapped, operations: {} }, null, 2)); this.state.projects.push(manifest);
    return this.completeMutation(this.summary(manifest));
  }
}
