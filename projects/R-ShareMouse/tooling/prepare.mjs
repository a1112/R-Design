import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, lstat, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import { normalizeDependencies } from './dependencies.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|svg|html|txt|md|xml|ya?ml|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|pdf)$/i;
const binary = /\.(?:png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|pdf)$/i;
const blockedName = /(?:^\.|(?:^|[._-])(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)|\.(?:pem|key|crt|p12|pfx|keystore)$)/i;
const testFile = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|test|tests)(?:\/|$))/;
const normalized = value => value.replaceAll(path.sep, '/');

async function files(root) {
  const result = [];
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      if (name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(name)) continue;
      const item = path.join(relative, name), stat = await lstat(path.join(root, item));
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${item}`);
      if (stat.isDirectory()) await visit(item);
      else if (stat.isFile()) result.push(normalized(item));
    }
  }
  await visit(); return result;
}

function relativeImport(from, to) {
  const value = normalized(path.relative(path.dirname(from), to));
  return value.startsWith('.') ? value : `./${value}`;
}

export async function prepare(name, sourceRoot = path.resolve(repoRoot, '../sources', name)) {
  const projectRoot = path.join(repoRoot, 'projects', name);
  const config = JSON.parse(await readFile(path.join(projectRoot, 'adapter.json'), 'utf8'));
  let privateAdapter;
  const privateRoot = path.join(repoRoot, '.rdesign/desktop-adapters');
  if (config.source.visibility === 'private') {
    try {
      privateAdapter = await import(pathToFileURL(path.join(privateRoot, 'private-adapters.mjs')).href);
      Object.assign(config, JSON.parse(await readFile(path.join(privateRoot, `${name}.json`), 'utf8')));
    } catch (error) { throw new Error(`Private source adapters require the local delivery in ${privateRoot}: ${error.message}`); }
  }
  sourceRoot = path.resolve(sourceRoot);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  if (sha !== config.source.sha) throw new Error(`${name} must use ${config.source.sha}; found ${sha}`);
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sourceRoot, encoding: 'utf8' }).trim()) throw new Error('Upstream checkout has changes');
  const frontend = path.resolve(sourceRoot, config.source.frontend);
  const committed = new Map(execFileSync('git', ['--no-replace-objects', 'ls-tree', '-r', '-z', sha], { cwd: sourceRoot, maxBuffer: 8 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean).map(record => {
    const split = record.indexOf('\t'), [mode, kind, blob] = record.slice(0, split).split(' ');
    return [record.slice(split + 1), { mode, kind, blob }];
  }));
  const committedBytes = file => execFileSync('git', ['--no-replace-objects', 'show', `${sha}:${file}`], { cwd: sourceRoot, maxBuffer: 16 * 1024 * 1024 });
  const output = path.join(repoRoot, '.rdesign', 'desktop-prepared', name);
  await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
  const mappings = [], omitted = [], renames = new Map(), assetSegments = [], textFiles = new Map(), embeddedDependencies = {}, embeddedDependencySources = [];
  const scopes = [...config.copy];
  for (const scope of scopes) {
    const base = path.resolve(frontend, scope.from);
    if (!base.startsWith(sourceRoot + path.sep) && base !== sourceRoot) throw new Error('Copy scope outside committed source');
    const prefix = normalized(path.relative(sourceRoot, base)) + '/';
    const committedFiles = [...committed.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)).sort();
    for (const file of committedFiles) {
      if (file.split('/').some(part => part.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(part))) continue;
      const originalPath = normalized(path.relative(sourceRoot, path.join(base, file)));
      const object = committed.get(originalPath);
      if (!['100644', '100755'].includes(object.mode) || object.kind !== 'blob') throw new Error(`Refusing committed symlink/non-file: ${originalPath}`);
      let target = normalized(path.join(scope.to, file));
      if (testFile.test(file) || !allowed.test(file)) { omitted.push({ path: originalPath, reason: testFile.test(file) ? 'non-runtime test source' : 'unsupported/non-UI asset' }); continue; }
      if (target.split('/').some(x => blockedName.test(x))) {
        const renamed = target.split('/').map(x => x.replace(/(^|[._-])(secrets?|credentials?|tokens?|passwords?)(?=[._-]|$)/ig, (_, prefix, word) => `${prefix}ui${word[0].toUpperCase()}${word.slice(1)}`)).join('/');
        if (renamed.split('/').some(x => blockedName.test(x))) throw new Error(`Cannot make UI-only path portable: ${originalPath}`);
        renames.set(target, renamed); target = renamed;
      }
      const bytes = committedBytes(originalPath);
      if (binary.test(file) && (bytes.length > 1024 * 1024 || file.endsWith('.pdf'))) {
        const base64 = bytes.toString('base64'), segments = [];
        for (let offset = 0, index = 0; offset < base64.length; offset += 512 * 1024, index++) {
          const segment = `${target}.part-${String(index + 1).padStart(2, '0')}.txt`;
          await mkdir(path.dirname(path.join(output, segment)), { recursive: true });
          await writeFile(path.join(output, segment), base64.slice(offset, offset + 512 * 1024)); segments.push(segment);
        }
        assetSegments.push({ path: target, upstream: originalPath, segments, sha256: hash(bytes), bytes: bytes.length });
        mappings.push({ upstream: originalPath, gitBlobSha: object.blob, adapted: segments, sha256: hash(bytes), bytes: bytes.length, change: 'base64 segments, original bytes preserved' });
      } else {
        if (bytes.length > 1024 * 1024) throw new Error(`Oversize source: ${originalPath}`);
        await mkdir(path.dirname(path.join(output, target)), { recursive: true });
        if (binary.test(file)) await writeFile(path.join(output, target), bytes);
        else textFiles.set(target, bytes.toString('utf8'));
        mappings.push({ upstream: originalPath, gitBlobSha: object.blob, adapted: target, sha256: hash(bytes), bytes: bytes.length });
      }
    }
  }
  for (const [file, original] of textFiles) {
    let source = original;
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      // Some committed Figma UI modules declare exact versions in their import
      // specifiers without listing them in the upstream package.json. Preserve
      // those declarations before normalizing the executable import syntax.
      const ast = parse(original, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      for (const node of ast.program.body) if (node.source?.type === 'StringLiteral' && node.importKind !== 'type' && node.exportKind !== 'type') {
        const versioned = /^((?:@[^/]+\/)?[^@]+)@([0-9][^/]*)$/.exec(node.source.value);
        if (versioned) {
          const [, dependency, version] = versioned;
          if (embeddedDependencies[dependency] && embeddedDependencies[dependency] !== version) throw new Error(`Conflicting embedded dependency versions for ${dependency}`);
          embeddedDependencies[dependency] = version;
          embeddedDependencySources.push({ file, dependency, requestedVersion: version });
        }
      }
      source = source.replace(/(['"])([^'"\n]+)\1/g, (all, quote, specifier) => {
        let target = specifier;
        const negated = target.startsWith('!.');
        if (negated) target = target.slice(1);
        const directorySpecifier = target.endsWith('/');
        if (target.startsWith('figma:asset/')) target = relativeImport(file, `src/assets/${target.slice(12)}`);
        else for (const [alias, destination] of Object.entries(config.aliases ?? {})) {
          if (target === alias || target.startsWith(`${alias}/`)) { target = relativeImport(file, destination + target.slice(alias.length)); break; }
        }
        // Figma Make source can carry versioned import specifiers.
        target = target.replace(/^((?:@[^/]+\/)?[^@]+)@[0-9].*$/, '$1');
        if (target.startsWith('.')) {
          let candidate = normalized(path.join(path.dirname(file), target.split('?')[0]));
          for (const [before, after] of Object.entries(config.relocations ?? {})) {
            if (candidate.startsWith(`${before}/`)) target = relativeImport(file, after + candidate.slice(before.length)) + (target.includes('?') ? '?' + target.split('?')[1] : '');
          }
          candidate = normalized(path.join(path.dirname(file), target.split('?')[0]));
          for (const [before, after] of renames) {
            if (candidate === before || candidate === before.replace(/\.[^.]+$/, '')) target = relativeImport(file, after) + (target.includes('?') ? '?' + target.split('?')[1] : '');
          }
        }
        if (directorySpecifier && !target.endsWith('/')) target += '/';
        return `${quote}${negated ? '!' : ''}${target}${quote}`;
      });
    }
    for (const [from, to] of Object.entries(config.assetRewrites ?? {})) source = source.replaceAll(from, to);
    if (file.endsWith('.css')) for (const [before, after] of renames) source = source.replaceAll(`./${path.basename(before)}`, `./${path.basename(after)}`);

    if (name === 'R-ShareMouse' && file === 'src/app/App.tsx') {
      source = source.replace('const [page, setPage] = useState<DesktopPage>("layout");', 'const [page, setPage] = useState<DesktopPage>(() => (["layout", "devices", "logs", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "layout") as DesktopPage);');
      source = source.replace('const [page, setPage] = useState<DesktopPage>(() =>', 'useEffect(() => { const syncPage = () => { const next = location.hash.slice(1); setPage((["layout", "devices", "logs", "settings"].includes(next) ? next : "layout") as DesktopPage); }; window.addEventListener("hashchange", syncPage); return () => window.removeEventListener("hashchange", syncPage); }, []);\n  const [page, setPage] = useState<DesktopPage>(() =>');
      source = source.replace('onClick={() => setPage(item.key)}', 'data-rdesign-id={`rshare-nav-${item.key}`} onClick={() => { setPage(item.key); history.replaceState(null, "", `#${item.key}`); }}');
      source = source.replace('className={`rshare-desktop-shell', 'data-rdesign-id="rshare-shell" className={`rshare-desktop-shell');
      source = source.replace('data-rdesign-id="rshare-shell"', 'data-rdesign-id="rshare-shell" data-rdesign-page={page}');
      source = source.replace('  let networkError: unknown = null;', '  if (WEB_NOOP_COMMANDS.has(command)) throw new Error(`纯设计预览：原生命令 ${command} 不可用`);\n  let networkError: unknown = null;');
    }

    if (name === 'R-Link' && file === 'src/hooks/useAccount.ts') {
      source = source.replace('  const refresh = useCallback(async () => {', "  const refresh = useCallback(async () => {\n    // Explicit UI-only service mode; no user/session or backend authentication is fabricated.\n    updateAccount({ status: 'ready', config: { mode: 'service', login_enabled: false, desktop_login_enabled: false }, session: null, error: '纯设计预览：账户服务不可用' });\n    return;");
    }
    if (name === 'R-Link' && file === 'src/utils/tauriWindow.ts') source = source.replace('if (!win) return;', "if (!win) throw new Error('纯设计预览：原生窗口操作不可用');").replace('if (!isTauriRuntime()) return;', "if (!isTauriRuntime()) throw new Error('纯设计预览：原生窗口操作不可用');");
    if (name === 'R-Link' && file === 'src/App.tsx') {
      source = source.replace('className="flex h-screen bg-', 'data-rdesign-route={activeTab} className="flex h-screen bg-');
      source = source.replace("useState<RouteId>('network')", "useState<RouteId>((location.hash.slice(1) || 'network') as RouteId)");
      source = source.replace('setActiveTab(route); };', 'setActiveTab(route); history.replaceState(null, "", `#${route}`); };');
      source = source.replace("setActiveTab('network');", "setActiveTab((location.hash.slice(1) || 'network') as RouteId);");
      source = source.replace('  const [sshVisited, setSshVisited]', '  useEffect(() => { const syncRoute = () => setActiveTab((location.hash.slice(1) || "network") as RouteId); window.addEventListener("hashchange", syncRoute); return () => window.removeEventListener("hashchange", syncRoute); }, []);\n  const [sshVisited, setSshVisited]');
    }
    if (name === 'R-Link' && file === 'src/components/pages/SSHView.tsx') source = source.replace(/placeholder="-----BEGIN [A-Z ]*PRIVATE KEY-----"/, 'placeholder="粘贴 SSH 密钥（纯设计预览不可用）"');

    if (privateAdapter) source = privateAdapter.adapt(name, file, source, config);
    await writeFile(path.join(output, file), source);
  }
  const mime = p => p.endsWith('.png') ? 'image/png' : p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
  const segmentImports = [], assetLines = [];
  assetSegments.forEach((asset, index) => {
    const names = asset.segments.map((segment, part) => { const id = `asset${index}part${part}`; segmentImports.push(`import ${id} from ${JSON.stringify(relativeImport('src/rdesignAssetUrls.ts', segment) + '?raw')};`); return id; });
    assetLines.push(`${JSON.stringify('/' + asset.path)}: ${JSON.stringify('data:' + mime(asset.path) + ';base64,')} + [${names.join(', ')}].join('')`);
  });
  await writeFile(path.join(output, 'src/rdesignAssetUrls.ts'), `${segmentImports.join('\n')}\nexport const assetUrls: Record<string, string> = { ${assetLines.join(',\n')} };\n`);
  await writeFile(path.join(output, 'src/rdesignBoundary.ts'), await readFile(path.join(repoRoot, 'projects/R-ShareMouse/tooling/preview-boundary.ts')));
  for (const previewFile of config.privatePreviewFiles ?? []) {
    await writeFile(path.join(output, previewFile.to), await readFile(path.join(privateRoot, previewFile.from)));
  }
  await writeFile(path.join(output, 'src/rdesignBoot.ts'), "import { installPreviewBoundary } from './rdesignBoundary';\nimport { assetUrls } from './rdesignAssetUrls';\ninstallPreviewBoundary(assetUrls);\n");
  const upstreamMain = await readFile(path.join(output, 'src/main.tsx'), 'utf8');
  await writeFile(path.join(output, 'src/upstreamMain.tsx'), upstreamMain);
  await writeFile(path.join(output, 'src/main.tsx'), `import './rdesignBoot';\nimport React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { installRuntime } from '@rdesign/runtime-web';\nconst statusRoot = document.createElement('div');\ndocument.body.appendChild(statusRoot);\ncreateRoot(statusRoot).render(<aside data-rdesign-id="design-preview-notice" style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 2147483647, maxWidth: 460, padding: 8, borderRadius: 6, backgroundColor: '#fff4ce', color: '#4a3500', fontSize: 11, lineHeight: 1.5, borderWidth: 1, borderColor: '#d4aa43', borderStyle: 'solid', pointerEvents: 'none' }}>${config.previewNotice}</aside>);\ninstallRuntime();\nvoid import('./upstreamMain').catch(error => { statusRoot.dataset.rdesignBootError = String(error); console.error(error); });\n`);
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · R-Design</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
  const nonBrowserSourceArchives = [];
  for (const file of await files(path.join(output, 'src'))) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const relative = `src/${file}`, absolute = path.join(output, relative), text = await readFile(absolute, 'utf8');
    const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    if (ast.program.body.some(node => node.source?.type === 'StringLiteral' && node.source.value.startsWith('node:'))) {
      const preserved = relative + '.source.txt';
      await writeFile(path.join(output, preserved), text); await rm(absolute);
      for (const mapping of mappings) if (mapping.adapted === relative) mapping.adapted = preserved;
      nonBrowserSourceArchives.push({ original: relative, preserved, reason: 'Committed Node-only development helper; complete text retained as source reference, never executed in the browser' });
    }
  }
  const sourcePackage = JSON.parse(committedBytes(normalized(path.relative(sourceRoot, path.join(frontend, 'package.json')))).toString('utf8'));
  const originalFramework = { react: sourcePackage.dependencies?.react, 'react-dom': sourcePackage.dependencies?.['react-dom'] };
  sourcePackage.dependencies = { ...embeddedDependencies, ...sourcePackage.dependencies, ...config.extraDependencies };
  const requestedDependencies = await runtimeDependencies(output, sourcePackage);
  const dependencies = await normalizeDependencies(name, requestedDependencies);
  await writeFile(path.join(output, 'package.json'), JSON.stringify({ name: `@rdesign/preview-${name.toLowerCase()}`, private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, dependencies }, null, 2) + '\n');
  const provenance = { adapterVersion: 1, name, source: config.source, readMode: 'pinned committed Git objects only', originalFramework, mappings, omitted, assetSegments, nonBrowserSourceArchives, embeddedDependencySources, limitations: config.limitations, requestedRuntimeDependencies: requestedDependencies, runtimeDependencies: dependencies };
  await writeFile(path.join(output, 'src/rdesignProvenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  await writeFile(path.join(projectRoot, 'prepared-summary.json'), JSON.stringify({ name, source: config.source, readMode: provenance.readMode, originalFramework, copiedFiles: mappings.length, omittedFiles: omitted.length, nonBrowserSourceArchives, losslessSegmentedAssets: assetSegments.map(x => ({ path: x.path, sha256: x.sha256, bytes: x.bytes })), requestedRuntimeDependencies: requestedDependencies, runtimeDependencies: dependencies, validation: { schema: 'pending frozen tooling', checksum: 'pending generation', import: 'pending', runtime: 'pending', sourceMapping: 'pending', interactions: 'pending' } }, null, 2) + '\n');
  return { output, config, dependencies, provenance };
}

export async function runtimeDependencies(root, sourcePackage, complete = true) {
  const paths = new Set(await files(path.join(root, 'src')).then(items => items.map(item => `src/${item}`)));
  // Preserve declarations for every retained application module, including optional UI.
  // Reachable production execution is reported separately by the browser verifier.
  const seen = new Set(), pending = ['src/main.tsx', ...(complete ? [...paths].filter(file => /\.(?:[cm]?[jt]sx?|css)$/.test(file)) : [])];
  const dependencies = { '@rdesign/runtime-web': '*', react: sourcePackage.dependencies?.react ?? '^19.1.0', 'react-dom': sourcePackage.dependencies?.['react-dom'] ?? '^19.1.0' };
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file)) continue; seen.add(file);
    const source = await readFile(path.join(root, file), 'utf8');
    const imports = [];
    if (file.endsWith('.css')) imports.push(...[...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(match => match[1]));
    else {
      const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      const visit = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source?.type === 'StringLiteral' && node.importKind !== 'type' && node.exportKind !== 'type') imports.push(node.source.value);
        if (node.type === 'CallExpression' && node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') imports.push(node.arguments[0].value);
        if (node.type === 'NewExpression' && node.callee.name === 'URL' && node.arguments[0]?.type === 'StringLiteral') imports.push(node.arguments[0].value);
        for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) visit(value);
      };
      visit(ast);
    }
    for (const specifier of imports) {
      const clean = specifier.split('?')[0];
      if (clean.startsWith('.')) {
        const target = normalized(path.join(path.dirname(file), clean));
        const candidates = [target, ...['.ts', '.tsx', '.js', '.mjs', '.jsx', '.css', '/index.ts', '/index.tsx'].map(extension => target + extension), target.replace(/\.js$/, '.ts')];
        const resolved = candidates.find(candidate => paths.has(candidate));
        if (resolved && /\.(?:[cm]?[jt]sx?|css)$/.test(resolved)) pending.push(resolved);
      } else if (!/^(?:data:|https?:|\/)/.test(clean)) {
        const name = clean.startsWith('@') ? clean.split('/').slice(0, 2).join('/') : clean.split('/')[0];
        if (file.endsWith('.css') && ['tailwindcss', 'tw-animate-css'].includes(name)) continue; // compiled by the isolated fixed CSS tool
        if (name.startsWith('@rdesign/')) continue;
        const version = sourcePackage.dependencies?.[name] ?? sourcePackage.devDependencies?.[name];
        if (!version) throw new Error(`Undeclared runtime dependency ${name} in ${file}`);
        dependencies[name] = version;
      }
    }
  }
  return Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepare(process.argv[2] ?? 'R-ShareMouse', process.argv[3]);
  console.log(JSON.stringify({ output: result.output, dependencies: result.dependencies }));
}
