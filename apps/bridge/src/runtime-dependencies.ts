import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { REVIEWED_RUNTIME_DEPENDENCIES } from '../../../packages/project-workspace/src/runtime-dependencies.js';

/** Candidates have no node_modules. Resolve reviewed packages through the same host as live previews. */
export function runtimeDependencies(repoRoot: string): Plugin {
  const anchor = path.join(repoRoot, 'package.json');
  const names = Object.keys(REVIEWED_RUNTIME_DEPENDENCIES);
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
            'highlight-js-v1112/lib/core', ...['bash','cpp','css','diff','go','ini','java','javascript','json','markdown','powershell','python','rust','sql','typescript','xml','yaml'].map(name => 'highlight-js-v1112/lib/languages/' + name),
            'pdfjs-dist-v5/build/pdf.min.mjs', ...declared] },
        };
      }
    },
    async resolveId(source) {
      if (!names.some(name => source === name || source.startsWith(name + '/'))) return null;
      return this.resolve(source, anchor, { skipSelf: true });
    },
  };
}
