import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertGitWorktree, plainDirectory, readPlainFile } from './engineering-guards.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const frozenSha = '11e2461ecabcbed1be938fefb08a7a6b73bc2629';
export const frozenKind = 'merged-main';
export const frozenRoot = path.resolve(repoRoot, '../frozen-tool');
export function engineeringBundleFile(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid project name');
  const variant = process.env.RDESIGN_BUNDLE_VARIANT;
  if (variant !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(variant)) throw new Error('Invalid bundle variant');
  return path.join(repoRoot, '.rdesign/desktop-official-deliverables', `${name}.${frozenSha.slice(0, 7)}${variant ? '.' + variant : ''}.rdesign-project.json`);
}
export async function hostModule(relative) {
  await assertGitWorktree(frozenRoot, frozenSha);
  const target = path.resolve(frozenRoot, relative);
  if (!target.startsWith(frozenRoot + path.sep)) throw new Error('Host module escapes frozen root');
  await plainDirectory(path.dirname(target));
  await readPlainFile(frozenRoot, path.relative(frozenRoot, target).split(path.sep).join('/'));
  return import(pathToFileURL(target).href);
}
