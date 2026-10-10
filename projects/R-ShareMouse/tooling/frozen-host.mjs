import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './prepare.mjs';

export const frozenSha = 'd4f41d0e7ab552129a82d91648ecd3dade692de9';
export const frozenRoot = path.resolve(repoRoot, '../frozen-tool');
export async function hostModule(relative) {
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: frozenRoot, encoding: 'utf8' }).trim() !== frozenSha) throw new Error('Frozen host commit mismatch');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: frozenRoot, encoding: 'utf8' }).trim()) throw new Error('Frozen host has tracked modifications');
  return import(pathToFileURL(path.join(frozenRoot, relative)).href);
}
