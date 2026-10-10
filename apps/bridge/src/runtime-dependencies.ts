import path from 'node:path';
import type { Plugin } from 'vite';
import { REVIEWED_RUNTIME_DEPENDENCIES } from '../../../packages/project-workspace/src/runtime-dependencies.js';

/** Candidates have no node_modules. Resolve reviewed packages through the same host as live previews. */
export function runtimeDependencies(repoRoot: string): Plugin {
  const anchor = path.join(repoRoot, 'package.json');
  const names = Object.keys(REVIEWED_RUNTIME_DEPENDENCIES);
  return {
    name: 'rdesign-reviewed-runtime-dependencies',
    enforce: 'pre',
    async resolveId(source) {
      if (!names.some(name => source === name || source.startsWith(name + '/'))) return null;
      return this.resolve(source, anchor, { skipSelf: true });
    },
  };
}
