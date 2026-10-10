import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const excluded = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git|\.rdesign|test|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const secretName = /(?:^\.|(?:^|[._-])(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)|\.(?:pem|key|crt|p12|pfx|keystore)$)/i;
const extensions = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|svg|html|txt|md|xml|yaml|yml|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;
const textExtension = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|svg|html|txt|md|xml|yaml|yml)$/i;
const codeExtension = /\.[cm]?[jt]sx?$/i;
const fromGit = (source, commit, file) => execFileSync('git', ['show', `${commit}:${file}`], { cwd: source, maxBuffer: 32 * 1024 * 1024 });
const relImport = (from, to) => { const relative = path.posix.relative(path.posix.dirname(from), to); return relative.startsWith('.') ? relative : './' + relative; };
const nativeModules = new Map(['core', 'event', 'window', 'webviewWindow', 'dpi'].map(name => [`@tauri-apps/api/${name}`, 'src/rdesign-preview/native.ts']));

function hashAnchors(source, length, checksum) {
  if (!Number.isInteger(length) || length < 1 || length > 1024 * 1024 || !/^[0-9a-f]{64}$/.test(checksum)) throw new Error('Invalid hashed source anchor');
  const positions = [];
  for (let offset = 0; offset <= source.length - length; offset++) if (sha(source.slice(offset, offset + length)) === checksum) positions.push(offset);
  return positions;
}

function applyEdits(source, edits) {
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

function rewriteImports(source, file, workspaceAliases = {}) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const edits = [];
  const replace = node => {
    const destination = nativeModules.get(node.value) ?? workspaceAliases[node.value];
    if (destination) edits.push({ start: node.start, end: node.end, text: JSON.stringify(relImport(file, destination)) });
  };
  traverse(ast, {
    ImportDeclaration(p) { replace(p.node.source); },
    ExportNamedDeclaration(p) { if (p.node.source) replace(p.node.source); },
    ExportAllDeclaration(p) { replace(p.node.source); },
    CallExpression(p) { if (p.node.callee.type === 'Import' && p.node.arguments[0]?.type === 'StringLiteral') replace(p.node.arguments[0]); },
  });
  return applyEdits(source, edits);
}

function pin(source, rule) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const edits = [];
  traverse(ast, { JSXOpeningElement(p) {
    const node = p.node;
    if (node.name.type !== 'JSXIdentifier' || node.name.name !== rule.tag) return;
    const opening = source.slice(node.start, node.end);
    if (!hashAnchors(opening, rule.containsLength, rule.containsSha256).length || opening.includes('data-rdesign-id=')) return;
    edits.push({ start: node.name.end, end: node.name.end, text: rule.expression ? ` data-rdesign-id={${rule.expression}}` : ` data-rdesign-id="${rule.id}"` });
  } });
  if (edits.length !== (rule.count ?? 1)) throw new Error(`Pin ${rule.id}: expected ${rule.count ?? 1}, found ${edits.length}`);
  return applyEdits(source, edits);
}

export async function prepare(name, source, output) {
  const configRoot = path.join(repoRoot, 'projects', name);
  const config = JSON.parse(await readFile(path.join(configRoot, 'engineering.json'), 'utf8'));
  source = path.resolve(source); output = path.resolve(output);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (head !== config.source.commit) throw new Error(`${name}: source HEAD is not pinned commit`);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' });
  if (status) throw new Error(`${name}: source must be an untouched checkout`);
  if (!(output.startsWith(path.resolve(repoRoot, '..') + path.sep) || output.startsWith('/tmp/'))) throw new Error('Stage outside the delegated workspace');
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error(`Stage must be empty: ${output}`);
  const all = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', config.source.commit], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
  const ledger = { schemaVersion: 1, source: config.source, stagedFiles: [], omitted: [], adapters: [], splitResources: [] };
  const staged = new Map();
  const save = async (file, bytes) => {
    const absolute = path.join(output, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes); staged.set(file, bytes);
  };
  for (const file of all) {
    const capture = config.capture.find(root => file === root || file.startsWith(root + '/'));
    if (!capture) continue;
    if (excluded.test(file) || (file.split('/').some(part => secretName.test(part)) && !config.sourcePathMap?.[file]) || !extensions.test(file)) { ledger.omitted.push({ file, reason: 'development-only, secret-name, or unsupported file type' }); continue; }
    const bytes = fromGit(source, config.source.commit, file);
    const target = config.sourcePathMap?.[file] ?? 'src/upstream/' + file;
    if (bytes.length > 1024 * 1024) {
      if (textExtension.test(file)) throw new Error(`${file}: text exceeds v1 1 MiB limit`);
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
        const chunk = `src/rdesign-preview/resources/${path.basename(file)}.part-${chunks.length + 1}.json`;
        await save(chunk, JSON.stringify({ base64: bytes.subarray(offset, offset + 512 * 1024).toString('base64') })); chunks.push(chunk);
      }
      ledger.splitResources.push({ file, target, sha256: sha(bytes), bytes: bytes.length, chunks });
      continue;
    }
    let modified = bytes;
    if (codeExtension.test(file)) modified = Buffer.from(rewriteImports(bytes.toString('utf8'), target, config.workspaceAliases));
    await save(target, modified);
    ledger.stagedFiles.push({ sourcePath: file, path: target, sourceSha256: sha(bytes), sha256: sha(modified), transformed: !bytes.equals(modified) });
  }
  for (const patch of config.replacements ?? []) {
    const file = 'src/upstream/' + patch.file;
    let content = (staged.get(file) ?? Buffer.from('')).toString('utf8');
    const matches = hashAnchors(content, patch.beforeLength, patch.beforeSha256);
    const count = matches.length;
    if (count !== (patch.count ?? 1)) throw new Error(`${file}: replacement expected ${patch.count ?? 1}, found ${count}`);
    content = applyEdits(content, matches.map(start => ({ start, end: start + patch.beforeLength, text: patch.after })));
    await save(file, Buffer.from(content));
    ledger.adapters.push({ file, kind: patch.reason, beforeSha256: patch.beforeSha256, afterSha256: sha(patch.after) });
  }
  for (const rule of config.pins ?? []) {
    const file = 'src/upstream/' + rule.file;
    await save(file, Buffer.from(pin(staged.get(file).toString('utf8'), rule)));
    ledger.adapters.push({ file, kind: 'stable scenario target', id: rule.id });
  }
  const previewSource = path.join(configRoot, 'preview');
  async function overlay(directory, relative = '') {
    for (const name of await readdir(directory)) {
      const file = relative ? relative + '/' + name : name;
      const stat = await lstat(path.join(directory, name));
      if (stat.isSymbolicLink()) throw new Error('Overlay symlinks are forbidden');
      if (stat.isDirectory()) await overlay(path.join(directory, name), file);
      else {
        await save('src/rdesign-preview/' + file, await readFile(path.join(directory, name)));
        ledger.adapters.push({ file: 'src/rdesign-preview/' + file, kind: 'explicit preview overlay' });
      }
    }
  }
  await overlay(path.join(repoRoot, 'projects/R-Box/preview'));
  if (name !== 'R-Box') { try { await overlay(previewSource); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  if (ledger.splitResources.length) {
    const declarations = []; const entries = [];
    for (const [index, resource] of ledger.splitResources.entries()) {
      const names = resource.chunks.map((chunk, i) => `resource${index}part${i}`);
      resource.chunks.forEach((chunk, i) => declarations.push(`import ${names[i]} from ${JSON.stringify(relImport('src/rdesign-preview/resource-urls.ts', chunk))};`));
      entries.push(`${JSON.stringify(path.basename(resource.file))}: URL.createObjectURL(new Blob([${names.map(n => `Uint8Array.from(atob(${n}.base64), char => char.charCodeAt(0))`).join(',')}], {type:'image/png'}))`);
    }
    await save('src/rdesign-preview/resource-urls.ts', `${declarations.join('\n')}\nexport const resourceUrls = {${entries.join(',')}};\n`);
  }
  const version = JSON.parse(fromGit(source, config.source.commit, config.packageFile).toString('utf8')).version;
  await save('src/upstream/rdesign-metadata.json', JSON.stringify({ name: config.name, version }));
  await save('src/rdesign-preview/provenance.json', JSON.stringify(ledger, null, 2));
  const additional = config.dependencies ?? {};
  await save('package.json', JSON.stringify({ name: '@rdesign/preview-' + name.toLowerCase(), version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, dependencies: { '@rdesign/runtime-web': '*', react: '^19.1.0', 'react-dom': '^19.1.0', ...additional } }, null, 2) + '\n');
  await save('index.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${name} · 设计预览</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
  await save('src/main.tsx', `import { installRuntime } from '@rdesign/runtime-web';\nimport { mountPreview, previewFailure } from './rdesign-preview/notice';\nmountPreview(${JSON.stringify({ name, notice: config.notice, source: config.source })});\ninstallRuntime();\nvoid import(${JSON.stringify('./upstream/' + config.entry)}).catch(previewFailure);\n`);
  const scenarios = JSON.parse(await readFile(path.join(configRoot, 'scenarios.json'), 'utf8'));
  for (const scenario of scenarios) scenario.dependencies = [...staged.keys()].filter(file => file.startsWith('src/')).sort();
  for (const entry of ledger.stagedFiles) { entry.sha256 = sha(staged.get(entry.path)); entry.transformed = entry.sha256 !== entry.sourceSha256; }
  await save('src/rdesign-preview/provenance.json', JSON.stringify(ledger, null, 2));
  const result = { name, source: config.source, sourceRoot: output, sourceFileCount: staged.size, sourceBytes: [...staged.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0), scenarios, ledger };
  await writeFile(path.join(output, '..', name + '.prepared.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ name, source: config.source.commit, sourceFileCount: result.sourceFileCount, sourceBytes: result.sourceBytes, adapters: ledger.adapters.length, splitResources: ledger.splitResources.length }));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, source, output] = process.argv.slice(2);
  if (!name || !source || !output) throw new Error('Usage: node projects/R-Box/prepare.mjs <repo> <pinned-source> <empty-stage>');
  await prepare(name, source, output);
}
