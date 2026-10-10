import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { repoRoot, frozenRoot, frozenSha } from './frozen-host.mjs';
import { assertGitWorktree, realGit, plainDirectory, readPlainFile, copyPreparedDirectory, ensurePlainDirectory, writePlainFile } from './engineering-guards.mjs';

const handoffFile = process.argv[2];
const names = process.argv.slice(3);
if (!handoffFile || !names.length || names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error('Pass the frozen handoff JSON and explicit project names');
const readJson = async file => JSON.parse((await readPlainFile(await plainDirectory(path.dirname(path.resolve(file))), path.basename(file))).bytes.toString('utf8'));
const handoff = await readJson(handoffFile);
await assertGitWorktree(frozenRoot, frozenSha);
if (handoff.candidate.sha !== frozenSha) {
  assert(process.env.RDESIGN_PREPARED_HANDOFF_SHA === handoff.candidate.sha, 'An ancestor prepared-source handoff requires its explicit SHA');
  realGit(frozenRoot, ['merge-base', '--is-ancestor', handoff.candidate.sha, frozenSha]);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const namespace = process.env.RDESIGN_PREPARED_OUTPUT_NAMESPACE;
assert(namespace === undefined || /^[A-Za-z0-9_-]{1,64}$/.test(namespace), 'Invalid prepared-output namespace');
for (const name of names) {
  const upstream = handoff.validation.formalPacking.find(item => item.name === name);
  assert(upstream, 'Project must be explicitly included in the frozen handoff');
  const config = await readJson(upstream.config);
  const folder = await plainDirectory(path.join(repoRoot, 'projects', name));
  const adapter = await readJson(path.join(folder, 'adapter.json'));
  assert.equal(config.commit, adapter.source.sha);
  const sourceRoot = path.resolve(repoRoot, '../sources', name);
  await assertGitWorktree(sourceRoot, config.commit);
  const boundary = await ensurePlainDirectory(repoRoot, '.rdesign/desktop-official-prepared');
  const prepared = path.join(boundary, frozenSha, ...(namespace ? [namespace] : []), name);
  const copied = await copyPreparedDirectory(config.preparedDirectory, prepared, boundary);
  const hashes = copied.files.map(file => ({ path: file.path, sha256: digest(file.bytes) }));
  const recipe = { ...config, repositoryRoot: path.relative(repoRoot, sourceRoot), preparedDirectory: path.relative(repoRoot, prepared) };
  await writePlainFile(folder, 'official-packing.config.json', JSON.stringify(recipe, null, 2) + '\n');
  await writePlainFile(folder, 'official-preparation-summary.json', JSON.stringify({ name, testedHostSha: frozenSha, preparedHandoffSha: handoff.candidate.sha, source: adapter.source, copiedFileCount: copied.files.length, byteIdenticalPreparedCopy: true, copyIsolation: { independentDirectories: copied.independentDirectories, independentFileInodes: copied.independentFileInodes, noAliases: copied.noAliases }, sourceFiles: hashes, scope: 'Complete prepared source/resources; dormant modules remain verbatim references; no additional dependency installation or host overrides. An explicitly supplied ancestor handoff only establishes the source recipe; actual compatibility is checked independently on testedHostSha.', parentFrozenChecksum: upstream.checksum }, null, 2) + '\n');
  console.log(JSON.stringify({ name, copiedFiles: copied.files.length, config: path.join(folder, 'official-packing.config.json') }));
}
