import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const host = path.resolve(repository, '../frozen-tool');
export const dependencyRoot = path.join(repository, 'projects/R-ShareMouse/tooling/dependencies/node_modules');
export const dependencyAliases = {'R-Link': { 'lucide-react': 'lucide-react-v0487' },
'R-ShareMouse': { 'lucide-react': 'lucide-react-v0487' }};

/** Match the actual isolated execution versions, including the host React 19 runtime. */
export async function normalizeDependencies(name, requested) {
  const entries = await Promise.all(Object.keys(requested).map(async key => {
    if (key.startsWith('@rdesign/')) return [key, '*'];
    const directory = ['react', 'react-dom', '@tauri-apps/api'].includes(key)
      ? path.join(host, 'node_modules', key)
      : path.join(dependencyRoot, dependencyAliases[name]?.[key] ?? key);
    const installed = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (['react', 'react-dom'].includes(key) && !installed.version.startsWith('19.')) throw new Error('The prepared desktop adapters require a verified React 19 host');
    return [key, installed.version];
  }));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
