import path from 'node:path';
import { repoRoot } from './prepare.mjs';
import { dependencyRoot, dependencyAliases } from './dependencies.mjs';
import { frozenRoot, hostModule } from './frozen-host.mjs';

const { BrowserRuntime } = await hostModule('apps/bridge/src/runtime.ts');
const { fileBoundary } = await hostModule('apps/bridge/src/vite-security.ts');

/** Compatibility rehearsal only. These dependency overrides are not reviewed host support. */
export class PreviewRuntime extends BrowserRuntime {
  constructor(name, root, kind = 'live', privateDirectory) {
    super(root, frozenRoot, kind, 0, privateDirectory);
    this.projectName = name;
  }
  config() {
    const config = super.config();
    const allow = [this.root, path.join(frozenRoot, 'packages/runtime-web'), path.join(frozenRoot, 'packages/protocol'), path.join(frozenRoot, 'node_modules'), dependencyRoot];
    const aliases = Object.fromEntries(Object.entries(dependencyAliases[this.projectName] ?? {}).map(([requested, installed]) => [requested, path.join(dependencyRoot, installed)]));
    aliases['@tauri-apps/api'] = path.join(frozenRoot, 'node_modules/@tauri-apps/api');
    return { ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, ...aliases } }, optimizeDeps: { exclude: ['pdfjs-dist', 'pdfjs-dist-v5'] }, plugins: [fileBoundary({ root: this.root, allow, privateRoots: [] }), ...config.plugins.slice(1)], server: { ...config.server, fs: { ...config.server.fs, allow } }, worker: { format: 'es' } };
  }
}
