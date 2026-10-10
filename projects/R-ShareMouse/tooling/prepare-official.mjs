import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot, frozenSha } from './frozen-host.mjs';

const handoffFile = process.argv[2];
const names = process.argv.slice(3);
if (!handoffFile || !names.length) throw new Error('Pass the frozen handoff JSON and explicit project names');
const handoff = JSON.parse(await readFile(handoffFile, 'utf8'));
assert.equal(handoff.candidate.sha, frozenSha);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Prepared copies must contain regular files only');
    if (['node_modules', 'dist', '.git', '.rdesign'].includes(entry.name)) throw new Error('Unexpected generated/dependency/history directory');
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, file));
    else if (entry.isFile()) result.push(file);
  }
  return result.sort();
}
for (const name of names) {
  const upstream = handoff.validation.formalPacking.find(item => item.name === name);
  assert(upstream, 'Project must be explicitly included in the frozen handoff');
  const config = JSON.parse(await readFile(upstream.config, 'utf8'));
  const adapter = JSON.parse(await readFile(path.join(repoRoot, 'projects', name, 'adapter.json'), 'utf8'));
  assert.equal(config.commit, adapter.source.sha);
  const sourceRoot = path.resolve(repoRoot, '../sources', name);
  assert.equal(execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), config.commit);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), '');
  const inputFiles = await files(config.preparedDirectory);
  const prepared = path.join(repoRoot, '.rdesign/desktop-official-prepared', frozenSha, name);
  await mkdir(path.dirname(prepared), { recursive: true });
  await cp(config.preparedDirectory, prepared, { recursive: true, force: false, errorOnExist: true });
  assert.deepEqual(await files(prepared), inputFiles);
  const hashes = [];
  for (const file of inputFiles) {
    const original = await readFile(path.join(config.preparedDirectory, file));
    assert(original.equals(await readFile(path.join(prepared, file))));
    hashes.push({ path: file, sha256: digest(original) });
  }
  const recipe = { ...config, repositoryRoot: path.relative(repoRoot, sourceRoot), preparedDirectory: path.relative(repoRoot, prepared) };
  const folder = path.join(repoRoot, 'projects', name);
  await writeFile(path.join(folder, 'official-packing.config.json'), JSON.stringify(recipe, null, 2) + '\n');
  await writeFile(path.join(folder, 'official-preparation-summary.json'), JSON.stringify({ name, testedHostSha: frozenSha, source: adapter.source, copiedFileCount: inputFiles.length, byteIdenticalPreparedCopy: true, sourceFiles: hashes, scope: 'Complete prepared source/resources; dormant modules remain verbatim references; no additional dependency installation or host overrides', parentFrozenChecksum: upstream.checksum }, null, 2) + '\n');
  console.log(JSON.stringify({ name, copiedFiles: inputFiles.length, config: path.join(folder, 'official-packing.config.json') }));
}
