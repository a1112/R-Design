import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const identity = stat => `${stat.dev}:${stat.ino}`;
const inside = (root, target) => target.startsWith(root + path.sep);
function relativeFile(value) {
  assert(typeof value === 'string' && value && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid relative file');
  return value;
}
export function realGit(root, args) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) delete env[key];
  return execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { env, maxBuffer: 24 * 1024 * 1024 });
}

/** Reject aliases at the root and every ancestor, rather than silently canonicalizing an alias. */
export async function plainDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Directory root/ancestor must be a real directory: ' + current);
  }
  assert.equal(await realpath(absolute), absolute, 'Directory alias is not allowed');
  return absolute;
}

export async function readPlainFile(root, relative) {
  const parent = await plainDirectory(path.dirname(path.join(root, relativeFile(relative))));
  assert(parent === root || inside(root, parent), 'File escapes its approved root');
  const file = path.join(root, relative);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    assert(stat.isFile() && stat.nlink === 1n, 'File must be regular and unshared: ' + relative);
    assert.equal(await realpath(file), file, 'File alias is not allowed');
    return { bytes: await handle.readFile(), stat, identity: identity(stat) };
  } finally { await handle.close(); }
}

export async function assertGitWorktree(root, expectedSha) {
  root = await plainDirectory(root);
  assert(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(expectedSha), 'A complete pinned commit is required');
  assert.equal(realGit(root, ['rev-parse', '--show-toplevel']).toString().trim(), root, 'Git worktree root mismatch');
  assert.equal(realGit(root, ['rev-parse', 'HEAD']).toString().trim(), expectedSha, 'Frozen/source commit mismatch');
  assert.equal(realGit(root, ['status', '--porcelain', '--untracked-files=all']).toString().trim(), '', 'Frozen/source worktree has modifications');
  const algorithm = realGit(root, ['rev-parse', '--show-object-format']).toString().trim();
  assert(['sha1', 'sha256'].includes(algorithm));
  const records = realGit(root, ['ls-tree', '-r', '-z', expectedSha]).toString('utf8').split('\0').filter(Boolean);
  for (const record of records) {
    const tab = record.indexOf('\t'), [mode, kind, oid] = record.slice(0, tab).split(' '), file = record.slice(tab + 1);
    assert(kind === 'blob' && ['100644', '100755'].includes(mode), 'Only regular tracked source files are supported');
    const actual = await readPlainFile(root, file);
    const hash = createHash(algorithm).update(`blob ${actual.bytes.length}\0`).update(actual.bytes).digest('hex');
    assert.equal(hash, oid, 'Actual worktree bytes differ from real Git object: ' + file);
    assert.equal(Boolean(actual.stat.mode & 0o111n), mode === '100755', 'Actual worktree executable mode differs: ' + file);
  }
  return { passed: true, realObjects: true, trackedFiles: records.length, rawWorkingBytes: true };
}

export async function plainTree(root) {
  root = await plainDirectory(root); const records = [];
  async function visit(relative = '') {
    const directory = await plainDirectory(path.join(root, relative));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Prepared child symlinks are not allowed');
      assert(!['node_modules', 'dist', '.git', '.rdesign'].includes(entry.name), 'Prepared dependency/history/generated directory is not allowed');
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(file);
      else { assert(entry.isFile(), 'Prepared files must be regular'); records.push({ path: file, ...await readPlainFile(root, file) }); }
    }
  }
  await visit(); return records.sort((a, b) => a.path.localeCompare(b.path));
}

export async function ownedPreparedTree(directory, repository, source) {
  repository = await plainDirectory(repository);
  const boundary = await plainDirectory(path.join(repository, '.rdesign/desktop-official-prepared'));
  directory = await plainDirectory(directory);
  assert(inside(boundary, directory), 'Prepared directory is outside its real owned boundary');
  if (source) {
    source = await plainDirectory(source);
    assert(directory !== source && !inside(source, directory) && !inside(directory, source), 'Prepared directory overlaps source input');
  }
  const files = await plainTree(directory);
  return { directory, boundary, directoryIdentity: identity(await lstat(directory, { bigint: true })), files };
}

async function createDirectories(root, relative) {
  let current = root;
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await plainDirectory(current);
  }
}

export async function ensurePlainDirectory(root, relative) {
  root = await plainDirectory(root);
  if (relative) relativeFile(relative);
  await createDirectories(root, relative);
  return plainDirectory(path.join(root, relative));
}

/** Fresh directories and exclusive regular-file writes cannot copy a root symlink or share source inodes. */
export async function copyPreparedDirectory(input, destination, ownedBoundary) {
  input = await plainDirectory(input); ownedBoundary = await plainDirectory(ownedBoundary);
  destination = path.resolve(destination);
  assert(inside(ownedBoundary, destination), 'Copy destination escapes owned boundary');
  assert(input !== destination && !inside(input, destination) && !inside(destination, input), 'Input and destination must be disjoint');
  const original = await plainTree(input);
  await createDirectories(ownedBoundary, path.relative(ownedBoundary, path.dirname(destination)).split(path.sep).join('/'));
  await mkdir(destination, { mode: 0o700 });
  await plainDirectory(destination);
  assert.notEqual(identity(await lstat(input, { bigint: true })), identity(await lstat(destination, { bigint: true })), 'Copy root must be physically independent');
  for (const file of original) {
    await createDirectories(destination, path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path));
    const target = path.join(destination, file.path);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(file.bytes); } finally { await handle.close(); }
    const copied = await readPlainFile(destination, file.path);
    assert.notEqual(copied.identity, file.identity, 'Copy file must not share a source inode');
    assert(copied.bytes.equals(file.bytes), 'Copy bytes differ');
  }
  const result = await plainTree(destination);
  assert.deepEqual(result.map(file => file.path), original.map(file => file.path));
  return { inputFiles: original, files: result, independentDirectories: true, independentFileInodes: true, noAliases: true };
}

/** Writes reuse only the already-inspected owned inode; new files use exclusive no-follow creation. */
export async function writeOwnedPreparedFile(snapshot, relative, bytes) {
  relativeFile(relative);
  await plainDirectory(snapshot.directory);
  assert.equal(identity(await lstat(snapshot.directory, { bigint: true })), snapshot.directoryIdentity, 'Owned root identity changed');
  await plainDirectory(path.dirname(path.join(snapshot.directory, relative)));
  const expected = snapshot.files.find(file => file.path === relative);
  const flags = constants.O_WRONLY | constants.O_NOFOLLOW | (expected ? 0 : constants.O_CREAT | constants.O_EXCL);
  const handle = await open(path.join(snapshot.directory, relative), flags, 0o600);
  try {
    const stat = await handle.stat({ bigint: true }); assert(stat.isFile() && stat.nlink === 1n, 'Owned file became an alias/shared inode');
    if (expected) assert.equal(identity(stat), expected.identity, 'Owned file identity changed');
    await handle.truncate(0); await handle.writeFile(bytes);
  } finally { await handle.close(); }
}

/** Metadata writes also reject existing root/ancestor/leaf aliases before opening a writable inode. */
export async function writePlainFile(root, relative, bytes) {
  root = await plainDirectory(root); relativeFile(relative);
  let previous;
  try { previous = await readPlainFile(root, relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return writeOwnedPreparedFile({ directory: root, directoryIdentity: identity(await lstat(root, { bigint: true })), files: previous ? [{ path: relative, ...previous }] : [] }, relative, bytes);
}
