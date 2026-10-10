import path from 'node:path';
import { readFileSync } from 'node:fs';
import { repoRoot } from './prepare.mjs';
import { dependencyRoot, dependencyAliases } from './dependencies.mjs';
import { frozenRoot, hostModule } from './frozen-host.mjs';

const { BrowserRuntime } = await hostModule('apps/bridge/src/runtime.ts');
const { fileBoundary } = await hostModule('apps/bridge/src/vite-security.ts');
const { REVIEWED_RUNTIME_DEPENDENCIES } = await hostModule('packages/project-workspace/src/runtime-dependencies.ts');

/** Compatibility rehearsal only. These dependency overrides are not reviewed host support. */
export class PreviewRuntime extends BrowserRuntime {
  constructor(name, root, kind = 'live', privateDirectory) {
    super(root, frozenRoot, kind, 0, privateDirectory);
    this.projectName = name;
  }
  config() {
    const config = super.config();
    const allow = [this.root, path.join(frozenRoot, 'packages/runtime-web'), path.join(frozenRoot, 'packages/protocol'), path.join(frozenRoot, 'node_modules'), dependencyRoot];
    const manifest = JSON.parse(readFileSync(path.join(this.root, 'package.json'), 'utf8'));
    const overrides = dependencyAliases[this.projectName] ?? {};
    // Override conflicting host aliases and explicit version aliases only.
    // Other bare imports must keep package exports resolution (e.g. editor workers).
    const aliases = Object.fromEntries(Object.keys(manifest.dependencies ?? {}).filter(name => name !== '@tauri-apps/api' && (name in REVIEWED_RUNTIME_DEPENDENCIES || name in overrides)).map(name => [name, path.join(dependencyRoot, overrides[name] ?? name)]));
    aliases['@tauri-apps/api'] = path.join(frozenRoot, 'node_modules/@tauri-apps/api');
    return { ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, ...aliases } }, optimizeDeps: { exclude: ['pdfjs-dist', 'pdfjs-dist-v5'] }, plugins: [fileBoundary({ root: this.root, allow, privateRoots: [] }), ...config.plugins.slice(1)], server: { ...config.server, fs: { ...config.server.fs, allow } }, worker: { format: 'es' } };
  }
}
