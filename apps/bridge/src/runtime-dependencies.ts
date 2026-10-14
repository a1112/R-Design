import path from 'node:path';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from '@babel/parser';
import type { Plugin } from 'vite';
import { CORE_PROJECT_DEPENDENCIES, reviewedDependency, reviewedRuntimeDependencies, REACT18_RENDERER_DEPENDENCIES } from '../../../packages/project-workspace/src/runtime-dependencies.js';
import { REACT18_CORE_VERSIONS, assertProfileCoreVersions, assertProfileExecution, runtimeProfileFromPackage, type RuntimeProfile } from '../../../packages/project-workspace/src/runtime-profiles.js';
import { DomainError } from '../../../packages/document-core/src/index.js';

export function readRuntimeProfile(root: string): RuntimeProfile {
  const file = path.join(root, 'package.json');
  let stat; try { stat = lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'react19'; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new DomainError('IMPORT_CONFIG', '运行配置须来自项目内的常规 package.json', 400);
  let config; try { config = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new DomainError('IMPORT_CONFIG', '无效项目包配置', 400); }
  const profile = runtimeProfileFromPackage(config);
  assertProfileCoreVersions(config, profile); assertProfileExecution(config, profile);
  if (profile === 'react18') {
    for (const declarations of [config.dependencies, config.devDependencies, config.optionalDependencies]) {
      for (const [name, version] of Object.entries(declarations ?? {})) {
        if (!(CORE_PROJECT_DEPENDENCIES.has(name) && typeof version === 'string' && /^(?:\*|[\^~]?[0-9]+(?:\.[0-9x*]+){0,2})$/.test(version)) && !reviewedDependency(name, version, profile)) {
          throw new DomainError('IMPORT_CONFIG', 'React 18 工程依赖未登记', 400);
        }
      }
    }
  }
  return profile;
}

/** The trusted profile path is host-owned and cannot be supplied by an imported project. */
export function profileHostDependencies(repoRoot: string, profile: RuntimeProfile) {
  runtimeProfileFromPackage({ rdesign: { runtimeProfile: profile } });
  const aliases: Record<string, string> = { react: path.join(repoRoot, 'node_modules/react'), 'react-dom': path.join(repoRoot, 'node_modules/react-dom') };
  if (profile === 'react19') return { aliases, allow: [] as string[], anchor: path.join(repoRoot, 'package.json'), sceneIntrinsics: undefined };
  const anchor = path.join(repoRoot, 'packages/runtime-react18/package.json');
  const moduleRoot = path.join(repoRoot, 'packages/runtime-react18/node_modules');
  try {
    const trustedRoots = [path.join(repoRoot, 'node_modules'), moduleRoot].map(root => realpathSync(root));
    const require = createRequire(anchor);
    for (const [name, version] of Object.entries({ ...REACT18_CORE_VERSIONS, ...REACT18_RENDERER_DEPENDENCIES, '@types/three': '0.183.1' })) {
      let file: string;
      try { file = realpathSync(require.resolve(name + '/package.json')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
        // Three deliberately hides package.json; locate metadata only within installed host roots.
        let directory = path.dirname(realpathSync(require.resolve(name)));
        while (true) {
          if (!trustedRoots.some(root => directory.startsWith(root + path.sep))) throw new Error('Untrusted dependency root');
          const candidate = path.join(directory, 'package.json');
          if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === name) { file = realpathSync(candidate); break; }
          directory = path.dirname(directory);
        }
      }
      if (!trustedRoots.some(root => file.startsWith(root + path.sep))) throw new Error('Untrusted dependency root');
      const installed = JSON.parse(readFileSync(file, 'utf8'));
      if (installed.name !== name || installed.version !== version) throw new Error('Dependency version mismatch');
      if (!name.startsWith('@types/')) aliases[name] = path.dirname(file);
    }
    // Fiber extends its intrinsic catalog from Three. Keep DOM IDs off the entire frozen catalog.
    const three = require('three');
    const sceneIntrinsics: ReadonlySet<string> = new Set(['primitive', ...Object.keys(three)
      .filter(name => /^[A-Z]/.test(name) && typeof three[name] === 'function')
      .map(name => name[0].toLowerCase() + name.slice(1))]);
    return { aliases, allow: [moduleRoot], anchor, sceneIntrinsics };
  } catch { throw new DomainError('RUNTIME_PROFILE_DEPENDENCY', '宿主缺少冻结的 React 18 运行依赖，禁止回退或自动安装', 503); }
}

/** Candidates have no node_modules. Resolve reviewed packages through the same host as live previews. */
export function runtimeDependencies(repoRoot: string, profile: RuntimeProfile = 'react19', sourceRoot?: string): Plugin {
  const anchor = profile === 'react18' ? path.join(repoRoot, 'packages/runtime-react18/package.json') : path.join(repoRoot, 'package.json');
  const names = Object.keys(reviewedRuntimeDependencies(profile));
  const trustedRoots = [path.join(repoRoot, 'node_modules'), path.join(repoRoot, 'packages/runtime-react18/node_modules')];
  const sourceFile = (id: string | undefined) => Boolean(sourceRoot && id && id.split('?')[0].startsWith(sourceRoot + path.sep) && !trustedRoots.some(root => id.startsWith(root + path.sep)));
  const registered = (source: string) => names.some(name => source === name || source.startsWith(name + '/'));
  const approved = (source: string) => registered(source) || /^(?:react(?:-dom)?|@rdesign\/runtime-web)(?:\/|$)/.test(source);
  const assertSpecifier = (source: string) => {
    if (!source || source.includes('\\') || source.startsWith('//') || (!source.startsWith('.') && !source.startsWith('/') && !approved(source))) {
      throw new DomainError('IMPORT_CONFIG', '项目模块导入未登记或不受控', 400);
    }
  };
  let approvedRoots: string[] | undefined;
  let cacheDirectory: string | undefined;
  const permittedFile = (file: string) => {
    const actual = realpathSync(file);
    if (actual === realpathSync(path.join(repoRoot, 'node_modules/vite/dist/client/client.mjs'))) return true;
    if (cacheDirectory && actual.startsWith(cacheDirectory + path.sep)) return true;
    if (sourceRoot && actual.startsWith(sourceRoot + path.sep) && !path.relative(sourceRoot, actual).split(path.sep).includes('node_modules')) return true;
    approvedRoots ??= [...Object.values(profileHostDependencies(repoRoot, profile).aliases),
      path.join(repoRoot, 'packages/runtime-web')].map(root => realpathSync(root));
    if (approvedRoots.some(root => actual.startsWith(root + path.sep) && !path.relative(root, actual).split(path.sep).includes('node_modules'))) return true;
    // Registered packages other than the renderer can be hoisted or nested in the host workspace.
    const require = createRequire(anchor);
    for (const name of names) {
      try {
        const root = path.dirname(realpathSync(require.resolve(name + '/package.json')));
        if (actual.startsWith(root + path.sep) && !path.relative(root, actual).split(path.sep).includes('node_modules')) return true;
      } catch { /* Packages with restricted metadata exports are already verified renderer aliases. */ }
    }
    return false;
  };
  return {
    name: 'rdesign-reviewed-runtime-dependencies',
    enforce: 'pre',
    config(config) {
      // Reader workers and Mermaid discover shared dependencies at different times.
      // Prebundle this exact declared profile together so late discovery cannot
      // replace already loaded dynamic-import chunks while HMR is disabled.
      const project = JSON.parse(readFileSync(path.join(config.root ?? repoRoot, 'package.json'), 'utf8'));
      if (project.dependencies?.mermaid === '11.17.2' && project.dependencies?.['pdfjs-dist-v5'] === '5.7.284') {
        const declared = Object.keys(project.dependencies).filter(name => names.includes(name));
        const highlight: string[] = [];
        if (project.dependencies?.['highlight-js-v1112'] === '11.12.0') {
          const root = realpathSync(path.join(repoRoot, 'node_modules/highlight-js-v1112'));
          if (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '11.12.0') throw new Error('Highlight resource profile version mismatch');
          const languages = realpathSync(path.join(root, 'lib/languages'));
          if (!languages.startsWith(root + path.sep)) throw new Error('Highlight language directory escaped its installed profile');
          highlight.push('highlight-js-v1112/lib/core');
          for (const file of readdirSync(languages, { withFileTypes: true })) if (file.isFile() && /^[a-z0-9][a-z0-9_-]*(?:\.js)?\.js$/.test(file.name)) {
            if (!realpathSync(path.join(languages, file.name)).startsWith(languages + path.sep)) throw new Error('Highlight language escaped its installed profile');
            highlight.push('highlight-js-v1112/lib/languages/' + file.name.slice(0, -3));
          }
          highlight.sort();
        }
        return {
          // Vite's explicit optimizer resolver bypasses normal resolveId hooks.
          // These aliases still point only into the same authorized host modules.
          resolve: { alias: {
            ...Object.fromEntries(declared.map(name => [name, path.join(repoRoot, 'node_modules', name)])),
            // The package's browser export requires document. Its same pinned
            // entity-table implementation also works in genuine Web Workers.
            'decode-named-character-reference': path.join(repoRoot, 'node_modules/decode-named-character-reference/index.js'),
            'hast-util-from-html-isomorphic': path.join(repoRoot, 'node_modules/hast-util-from-html-isomorphic/index.js'),
          } },
          optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client',
            '@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/webviewWindow', '@tauri-apps/api/window',
            ...highlight,
            'pdfjs-dist-v5/build/pdf.min.mjs', ...declared] },
        };
      }
    },
    configResolved(config) { cacheDirectory = path.resolve(config.cacheDir, 'deps'); },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (profile !== 'react18') return;
        const document = html.replace(/<!--[\s\S]*?-->/g, '');
        if (/<base\b/i.test(document)) throw new DomainError('IMPORT_CONFIG', 'React 18 预览禁止 HTML base 重定向', 400);
        const decode = (value: string) => value.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, code: string) => {
          const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
          return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
        }).replace(/&(colon|sol|Tab|NewLine);/g, (_, name: string) => ({ colon: ':', sol: '/', Tab: '\t', NewLine: '\n' })[name]!);
        for (const script of document.matchAll(/<script\b([^>]*)>/gi)) {
          const attributes = new Map<string, string>();
          for (const item of script[1].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
            const name = item[1].toLowerCase();
            if (!attributes.has(name)) attributes.set(name, decode(item[2] ?? item[3] ?? item[4] ?? '').trim());
          }
          if (attributes.get('type')?.toLowerCase() === 'importmap') throw new DomainError('IMPORT_CONFIG', 'React 18 预览禁止项目 import map', 400);
          if (attributes.has('src')) {
            const source = attributes.get('src')!.replace(/\s/g, '');
            if (attributes.get('type')?.toLowerCase() !== 'module' || !source || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//') || source.startsWith('/@fs/') || source.split('/').includes('node_modules') || /[\\&\ufffd]/.test(source)) throw new DomainError('IMPORT_CONFIG', 'React 18 预览只接受项目内的受控模块脚本入口', 400);
          }
        }
      },
    },
    transform(code, id) {
      if (profile !== 'react18' || !sourceFile(id) || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id) || id.split('?')[0].endsWith('.d.ts')) return null;
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      const pureTypeImports = ast.program.body.filter(node => node.type === 'ImportDeclaration' &&
        (node.importKind === 'type' || node.specifiers.length > 0 && node.specifiers.every(item => item.type === 'ImportSpecifier' && item.importKind === 'type')));
      const assertSourceSpecifier = (source: string) => {
        assertSpecifier(source);
        if (source.startsWith('/@fs/') || source.split('/').includes('node_modules')) throw new DomainError('IMPORT_CONFIG', '项目源码须使用登记的包名称而非宿主依赖文件路径', 400);
      };
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source && node.importKind !== 'type' && node.exportKind !== 'type' && !pureTypeImports.includes(node)) assertSourceSpecifier(node.source.value);
        if (node.type === 'ImportExpression' || node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.type === 'Identifier' && node.callee.name === 'require')) {
          const argument = node.type === 'ImportExpression' ? node.source : node.arguments[0];
          if (argument?.type !== 'StringLiteral') throw new DomainError('IMPORT_CONFIG', 'React 18 配置禁止不受控动态模块导入', 400);
          assertSourceSpecifier(argument.value);
        }
        for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) {
          if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
        }
      };
      visit(ast.program);
      if (!pureTypeImports.length) return null;
      // Pure declarations have no runtime import. Preserve offsets for DOM source bindings.
      let transformed = code;
      for (const declaration of [...pureTypeImports].reverse()) {
        transformed = transformed.slice(0, declaration.start!) + transformed.slice(declaration.start!, declaration.end!).replace(/[^\r\n]/g, ' ') + transformed.slice(declaration.end!);
      }
      return { code: transformed, map: null };
    },
    async resolveId(source, importer) {
      if (profile === 'react18') {
        if (/^react-router(?:-dom)?(?:\/|$)/.test(source)) throw new DomainError('IMPORT_CONFIG', 'React 18 配置未授权 Router', 400);
        if (sourceFile(importer) && source !== 'vite/modulepreload-polyfill') {
          assertSpecifier(source);
          const resolved = await this.resolve(source, registered(source) ? anchor : importer, { skipSelf: true });
          if (resolved?.id === '/@react-refresh') return resolved;
          if (!resolved || !path.isAbsolute(resolved.id.split('?')[0]) || !permittedFile(resolved.id.split('?')[0])) throw new DomainError('IMPORT_CONFIG', '项目模块绕过受控宿主依赖边界', 400);
          return resolved;
        }
      }
      if (!registered(source)) return null;
      return this.resolve(source, anchor, { skipSelf: true });
    },
  };
}
