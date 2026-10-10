import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const frozenSha = '11e2461ecabcbed1be938fefb08a7a6b73bc2629';
export const frozenKind = 'merged-main';
export const frozenRoot = path.resolve(repoRoot, '../frozen-tool');
export async function hostModule(relative) {
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frozenRoot, encoding: 'utf8' }).trim() !== frozenSha) throw new Error('Frozen host commit mismatch');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: frozenRoot, encoding: 'utf8' }).trim()) throw new Error('Frozen host has tracked modifications');
  return import(pathToFileURL(path.join(frozenRoot, relative)).href);
}
