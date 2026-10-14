import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from '@babel/parser';
import type { Scenario } from '../../protocol/src/index.js';
import { createProject, digest, DomainError } from '../../document-core/src/index.js';
import { codeHash } from '../../source-binding/src/index.js';
import { assertPortableSourcePaths, isPrivateSourceName, projectPackage, readPortableSourceFiles, validatePortableProjectBundle,
  type PortableProjectBundle, type ProjectManifest } from './index.js';
import { CORE_PROJECT_DEPENDENCIES, reviewedRuntimeDependencies } from './runtime-dependencies.js';
import { runtimeProfileFromPackage, type RuntimeProfile } from './runtime-profiles.js';

const execute = promisify(execFile);
const sourceType = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|svg|html|txt|md|xml|yaml|yml|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;
const excluded = (name: string) => isPrivateSourceName(name) || /^(?:node_modules|dist|build|coverage)$/.test(name);
const executable = /^(?:vite|vitest|webpack|rollup|next|nuxt|babel|eslint|postcss|tailwind)\.config\./i;

export interface EngineeringConfig {
  repositoryRoot: string;
  repositoryUrl: string;
  commit: string;
  frontendDirectory: string;
  name: string;
  scenarios: Scenario[];
  limitations: string[];
  runtimeProfile?: RuntimeProfile;
  relocations?: Array<{ from: string; to: string }>;
  copies?: Array<{ from: string; to: string }>;
  edits?: Array<{ file: string; find: string; replace: string; expectedMatches?: number }>;
}

function relative(value: string): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(part => !part || part === '..' || part === '.')) {
    throw new DomainError('ENGINEERING_PATH', '工程生成配置路径必须为规范的相对路径', 400);
  }
  return value;
}

function runtimeImports(content: string): { specifiers: string[]; dynamic: boolean } {
  const ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const specifiers: string[] = []; let dynamic = false;
  for (const node of ast.program.body) if ('source' in node && node.source?.type === 'StringLiteral') {
    if ('importKind' in node && node.importKind === 'type' || 'exportKind' in node && node.exportKind === 'type') continue;
    const items = 'specifiers' in node ? node.specifiers : null;
    if (items?.length && items.every(item => 'importKind' in item && item.importKind === 'type' || 'exportKind' in item && item.exportKind === 'type')) continue;
    specifiers.push(node.source.value);
  }
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      if (node.arguments[0]?.type === 'StringLiteral') specifiers.push(node.arguments[0].value);
      else dynamic = true;
    }
    for (const [key, item] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) {
      if (Array.isArray(item)) item.forEach(visit); else if (item && typeof item === 'object') visit(item);
    }
  }; visit(ast.program);
  return { specifiers, dynamic };
}

const dependencyName = (specifier: string) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

export async function committedGit(config: Pick<EngineeringConfig, 'repositoryRoot' | 'repositoryUrl' | 'commit'>) {
  if (!/^[0-9a-f]{40}$/i.test(config.commit) || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(config.repositoryUrl)) throw new DomainError('ENGINEERING_ORIGIN', '必须提供精确提交 SHA 和不含凭据的 GitHub 仓库地址', 400);
  const git = async (args: string[], maximum = 1024 * 1024 + 1) => (await execute('git', ['--no-replace-objects', '-C', path.resolve(config.repositoryRoot), ...args], { encoding: 'buffer', maxBuffer: maximum })).stdout;
  const actualCommit = (await git(['rev-parse', '--verify', `${config.commit}^{commit}`])).toString('utf8').trim();
  if (actualCommit !== config.commit) throw new DomainError('ENGINEERING_ORIGIN', '提交身份不匹配', 400);
  return git;
}

/** A structural/source check. Browser execution and business assertions remain separate evidence. */
export function preflightEngineeringBundle(value: unknown) {
  validatePortableProjectBundle(value);
  const files = new Map(value.sourceFiles.map(file => [file.path, file]));
  const errors: string[] = [], warnings: string[] = [];
  const config = JSON.parse(files.get('package.json')?.content ?? '{}');
  const reviewed = reviewedRuntimeDependencies(runtimeProfileFromPackage(config));
  const dependencies = { ...config.dependencies, ...config.devDependencies, ...config.optionalDependencies };
  const resolve = (from: string, specifier: string, css = false) => {
    if (css && specifier.startsWith('#')) return;
    if (css && !/^[./]|^data:|^https?:/.test(specifier)) specifier = './' + specifier;
    const withoutQuery = specifier.split(/[?#]/)[0];
    if (!withoutQuery || withoutQuery.startsWith('#') || /^data:|^https?:|^\/\//.test(specifier)) return;
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const target = specifier.startsWith('/') ? withoutQuery.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), withoutQuery));
      const variants = [target, ...['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'].map(extension => target + extension)];
      if (!variants.some(file => files.has(file))) errors.push(`${from}: 缺少应用资源或源码 ${specifier}`);
      return;
    }
    const name = dependencyName(specifier);
    if (!['react', 'react-dom', '@rdesign/runtime-web', ...Object.keys(reviewed)].includes(name)) errors.push(`${from}: 浏览器依赖或路径别名未受支持 ${specifier}`);
    else if (!(name in dependencies)) errors.push(`${from}: 依赖没有声明 ${name}`);
  };
  for (const file of value.sourceFiles) {
    if (file.path.startsWith('public/')) errors.push(`${file.path}: 宿主禁用 publicDir，请明确搬移资源并修正引用`);
    if (file.encoding === 'base64') continue;
    if (/\.[cm]?[jt]sx?$/.test(file.path) && !file.path.endsWith('.d.ts')) {
      try {
        const imports = runtimeImports(file.content);
        imports.specifiers.forEach(specifier => resolve(file.path, specifier));
        if (imports.dynamic) warnings.push(`${file.path}: 动态 import 路径需运行验收`);
      } catch (error) { errors.push(`${file.path}: ${(error as Error).message}`); }
    }
    if (/\.css$/.test(file.path)) {
      for (const match of file.content.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) resolve(file.path, match[1], true);
      for (const match of file.content.matchAll(/@import\s+["']([^"']+)["']/g)) resolve(file.path, match[1], true);
      if (/@tailwind\b|@import\s+["']tailwindcss/.test(file.content)) errors.push(`${file.path}: Tailwind 源样式需先转换为可运行 CSS`);
    }
  }
  const main = files.get('src/main.tsx')!.content;
  if (!main.includes('@rdesign/runtime-web')) errors.push('src/main.tsx: 没有安装 R-Design 观察 SDK');
  if (!/src\/main\.tsx/.test(files.get('index.html')!.content)) errors.push('index.html: 标准入口没有引用 src/main.tsx');
  for (const scenario of value.document.project.scenarios) {
    for (const step of scenario.steps) if (!/^[a-zA-Z0-9_-]{1,128}$/.test(step.target)) errors.push(`${scenario.id}: 场景目标必须是受支持的 data-rdesign-id`);
    for (const dependency of scenario.dependencies) if (!files.has(dependency)) errors.push(`${scenario.id}: 缺少场景依赖 ${dependency}`);
  }
  if (!value.document.project.scenarios.some(scenario => scenario.viewport.width >= 1000) || !value.document.project.scenarios.some(scenario => scenario.viewport.width <= 760)) warnings.push('没有同时登记桌面与窄屏场景');
  warnings.push('结构预检不证明运行、后端、原生能力或业务状态转换；导入后场景须重新验收');
  return { passed: errors.length === 0, checksum: value.checksum, sourceFileCount: files.size,
    sourceBytes: value.sourceFiles.reduce((total, file) => total + Buffer.byteLength(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'), 0),
    scenarioCount: value.document.project.scenarios.length, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** Read committed Git objects, never source working-tree bytes, then build the existing v1 format. */
export async function generateEngineeringBundle(config: EngineeringConfig): Promise<PortableProjectBundle> {
  const git = await committedGit(config);
  const frontend = config.frontendDirectory === '.' ? '' : relative(config.frontendDirectory) + '/';
  const tree = (await git(['ls-tree', '-r', '-z', '--full-tree', config.commit, '--', frontend || '.'], 8 * 1024 * 1024)).toString('utf8').split('\0').filter(Boolean);
  const committed = new Map<string, { mode: string; sha: string }>();
  for (const record of tree) {
    const split = record.indexOf('\t'), [mode, type, sha] = record.slice(0, split).split(' ');
    if (type === 'blob') committed.set(record.slice(split + 1), { mode, sha });
  }
  const selected = new Map<string, { original: string; sha: string; bytes: Buffer }>();
  const select = async (original: string, target: string) => {
    relative(original); assertPortableSourcePaths([target]);
    if (original.split('/').some(part => excluded(part) || executable.test(part))) throw new DomainError('ENGINEERING_SOURCE', '不能通过复制规则导出私密文件或可执行配置', 400);
    const entry = committed.get(original);
    if (!entry || !['100644', '100755'].includes(entry.mode)) throw new DomainError('ENGINEERING_SOURCE', `缺少常规提交文件或遇到符号链接: ${original}`, 400);
    if (selected.has(target)) throw new DomainError('ENGINEERING_PATH', `生成路径重复: ${target}`, 400);
    selected.set(target, { original, sha: entry.sha, bytes: await git(['show', `${config.commit}:${original}`]) });
  };
  for (const [original, entry] of committed) {
    if (!original.startsWith(frontend)) continue;
    const file = original.slice(frontend.length);
    if (file.split('/').some(part => excluded(part) || executable.test(part)) || !sourceType.test(file) || !(file === 'package.json' || file === 'index.html' || /^(?:src|assets|public)\//.test(file))) continue;
    if (!['100644', '100755'].includes(entry.mode)) throw new DomainError('ENGINEERING_SOURCE', `不能静默省略应用符号链接: ${file}`, 400);
    const relocation = config.relocations?.find(item => file === item.from || file.startsWith(item.from + '/'));
    if (relocation) { relative(relocation.from); relative(relocation.to); }
    await select(original, relocation ? relocation.to + file.slice(relocation.from.length) : file);
  }
  for (const copy of config.copies ?? []) {
    // A referenced license/readme may be outside the frontend subtree, but must be committed.
    const from = relative(copy.from);
    if (!committed.has(from)) {
      const record = (await git(['ls-tree', config.commit, '--', from])).toString('utf8').trim();
      const split = record.indexOf('\t'), [mode, type, sha] = record.slice(0, split).split(' ');
      if (type === 'blob' && record.slice(split + 1) === from) committed.set(from, { mode, sha });
    }
    await select(from, copy.to);
  }
  assertPortableSourcePaths([...selected.keys(), 'src/rdesign-origin.json']);
  const packageFile = selected.get('package.json');
  if (!packageFile || !selected.has('src/main.tsx') || !selected.has('index.html')) throw new DomainError('ENGINEERING_ENTRY', '首版生成器需要 package.json、index.html、src/main.tsx', 400);
  const originalPackage = JSON.parse(packageFile.bytes.toString('utf8'));
  const declared = { ...originalPackage.devDependencies, ...originalPackage.dependencies, ...originalPackage.optionalDependencies };
  const profile = runtimeProfileFromPackage(config.runtimeProfile === undefined ? {} : { rdesign: { runtimeProfile: config.runtimeProfile } });
  const reviewed = reviewedRuntimeDependencies(profile);
  if (!originalPackage.dependencies?.react || !originalPackage.dependencies?.['react-dom']) throw new DomainError('ENGINEERING_FRAMEWORK', '首版生成器仅支持已登记依赖的 React 前端', 400);
  if (![declared.react, declared['react-dom']].every(version => typeof version === 'string' && (profile === 'react18' ? version.replace(/^[\^~]/, '') === '18.3.1' : /^[\^~]?19(?:\.|$)/.test(version)))) throw new DomainError('ENGINEERING_FRAMEWORK', '原 React 版本不符合所选受控运行配置', 400);
  const dependencies: Record<string, string> = {};
  for (const name of Object.keys(originalPackage.dependencies ?? {})) {
    if (CORE_PROJECT_DEPENDENCIES.has(name)) continue;
    const value = declared[name], version = typeof value === 'string' ? value.replace(/^[\^~]/, '') : '';
    if (reviewed[name] !== version) throw new DomainError('ENGINEERING_DEPENDENCY', `需要先登记并验证依赖及版本: ${name}`, 400);
    dependencies[name] = version;
  }
  const adaptations: Array<{ file: string; reason: string; beforeHash: string; afterHash: string }> = [];
  const change = (file: string, bytes: Buffer, reason: string) => {
    const item = selected.get(file); if (!item) throw new DomainError('ENGINEERING_EDIT', `编辑目标没有提交文件: ${file}`, 400);
    adaptations.push({ file, reason, beforeHash: digest(item.bytes), afterHash: digest(bytes) }); item.bytes = bytes;
  };
  change('package.json', Buffer.from(JSON.stringify(projectPackage(dependencies, profile), null, 2) + '\n'), '使用受控宿主脚本与固定运行依赖');
  for (const edit of config.edits ?? []) {
    if (!edit.find || !selected.has(edit.file)) throw new DomainError('ENGINEERING_EDIT', '编辑必须指定现有文件和非空原文', 400);
    const before = selected.get(edit.file)!.bytes.toString('utf8'), matches = before.split(edit.find).length - 1;
    if (matches !== (edit.expectedMatches ?? 1)) throw new DomainError('ENGINEERING_EDIT', `${edit.file}: 原文匹配数不符合明确适配配置`, 400);
    change(edit.file, Buffer.from(before.split(edit.find).join(edit.replace)), '明确配置的源码或资源引用适配');
  }
  for (const [file, item] of selected) if (/\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts')) {
    for (const specifier of runtimeImports(item.bytes.toString('utf8')).specifiers) {
      if (/^[./#]|^data:|^https?:/.test(specifier)) continue;
      const name = dependencyName(specifier);
      if (CORE_PROJECT_DEPENDENCIES.has(name) || !(name in declared)) continue;
      const value = declared[name], version = typeof value === 'string' ? value.replace(/^[\^~]/, '') : '';
      if (reviewed[name] !== version) throw new DomainError('ENGINEERING_DEPENDENCY', `需要先登记并验证依赖及版本: ${name}`, 400);
      dependencies[name] = version;
    }
  }
  const adaptedPackage = JSON.parse(packageFile.bytes.toString('utf8'));
  if (Object.keys(dependencies).some(name => !(name in (adaptedPackage.dependencies ?? {})))) {
    adaptedPackage.dependencies = { ...dependencies, ...adaptedPackage.dependencies };
    change('package.json', Buffer.from(JSON.stringify(adaptedPackage, null, 2) + '\n'), '保留实际浏览器导入的受控辅助声明依赖');
  }
  const entry = selected.get('src/main.tsx')!;
  if (entry.bytes.toString('utf8').includes('@rdesign/runtime-web')) throw new DomainError('ENGINEERING_SDK', '入口已接入 SDK，需先核对安装生命周期，不能重复注入', 400);
  change('src/main.tsx', Buffer.from("import { installRuntime as installRDesignRuntime } from '@rdesign/runtime-web';\n" + entry.bytes.toString('utf8') + '\nif (import.meta.env.DEV || import.meta.env.VITE_RDESIGN_RUNTIME === \'true\') installRDesignRuntime({ maxNodes: 2500 });\n'), '在根 React 渲染入口后安装开发观察 SDK');
  const origin = { schemaVersion: 1, repositoryUrl: config.repositoryUrl, commit: config.commit, frontendDirectory: config.frontendDirectory,
    sourceFiles: [...selected].map(([file, item]) => ({ file, original: item.original, gitBlobSha: item.sha })),
    runtimeDependencies: projectPackage(dependencies, profile).dependencies,
    ...(profile === 'react18' ? { runtimeProfile: profile } : {}),
    relocations: config.relocations ?? [], adaptations, limitations: config.limitations, verification: '运行、业务、原生与外部后端验收须另附证据' };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-engineering-'));
  try {
    for (const [file, item] of selected) { await mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await writeFile(path.join(directory, file), item.bytes); }
    await writeFile(path.join(directory, 'src/rdesign-origin.json'), JSON.stringify(origin, null, 2) + '\n');
    const sourceFiles = await readPortableSourceFiles(directory), revision = await codeHash(directory), now = new Date().toISOString();
    const project = createProject(revision); project.name = config.name; project.scenarios = structuredClone(config.scenarios); project.scenarios.forEach(scenario => { scenario.status = 'unverified'; });
    const manifest: ProjectManifest = { schemaVersion: 1, id: project.id, name: config.name, kind: 'owned', template: 'blank', createdAt: now, updatedAt: now, lastOpenedAt: now, favorite: false, archived: false, documentRevision: 1, codeRevision: revision, source: { kind: 'owned', directory: 'source' } };
    const payload = { format: 'rdesign-project' as const, schemaVersion: 1 as const, manifest, document: { schemaVersion: 1 as const, project, changes: [] }, sourceFiles };
    const bundle = { ...payload, checksum: digest(JSON.stringify(payload)) };
    const preflight = preflightEngineeringBundle(bundle);
    if (!preflight.passed) throw new DomainError('ENGINEERING_PREFLIGHT', preflight.errors.join('\n'), 400);
    return bundle;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
