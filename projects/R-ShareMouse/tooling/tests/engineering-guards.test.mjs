import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertGitWorktree, copyPreparedDirectory, ensurePlainDirectory, ownedPreparedTree, readPlainFile, realGit, writeOwnedPreparedFile, writePlainFile } from '../engineering-guards.mjs';
import { frozenRoot, frozenSha } from '../frozen-host.mjs';

const tooling = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const loader = path.join(frozenRoot, 'node_modules/tsx/dist/loader.mjs');
async function fixture(t) {
  // macOS temporary-directory aliases are deliberately resolved before creating approved roots.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rdesign-review-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, file, bytes) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes); }
const missing = async file => { await assert.rejects(access(file), error => error.code === 'ENOENT'); };
function git(root, args, replacements = false) {
  return execFileSync('git', [...(replacements ? [] : ['--no-replace-objects']), '-C', root, '-c', 'user.name=RDesign Synthetic Test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('host import rejects git-replace checkout bytes before executing them, then accepts actual pinned bytes', async t => {
  const root = await fixture(t), app = path.join(root, 'application'), host = path.join(root, 'frozen-tool');
  await mkdir(host); git(host, ['init']);
  const marker = '__rdesignSyntheticHostExecuted'; delete globalThis[marker]; t.after(() => { delete globalThis[marker]; });
  await put(host, 'payload.mjs', `globalThis.${marker} = 'A'; export const marker = 'A';\n`);
  git(host, ['add', '.']); git(host, ['commit', '-m', 'Synthetic A']); const a = git(host, ['rev-parse', 'HEAD']);
  await put(host, 'payload.mjs', `globalThis.${marker} = 'B'; export const marker = 'B';\n`);
  git(host, ['add', '.']); git(host, ['commit', '-m', 'Synthetic B']); const b = git(host, ['rev-parse', 'HEAD']);
  git(host, ['replace', a, b]); git(host, ['checkout', '--force', '--detach', a], true);
  assert.equal(git(host, ['rev-parse', 'HEAD'], true), a);
  assert.equal(git(host, ['status', '--porcelain'], true), '');
  assert.match(await readFile(path.join(host, 'payload.mjs'), 'utf8'), /'B'/);
  const relative = 'projects/R-ShareMouse/tooling/';
  await put(app, relative + 'engineering-guards.mjs', await readFile(path.join(tooling, 'engineering-guards.mjs')));
  const hostCode = (await readFile(path.join(tooling, 'frozen-host.mjs'), 'utf8')).replace(frozenSha, a);
  await put(app, relative + 'frozen-host.mjs', hostCode);
  const api = await import(pathToFileURL(path.join(app, relative, 'frozen-host.mjs')).href);
  await assert.rejects(api.hostModule('payload.mjs'), /modifications|Actual worktree bytes/);
  assert.equal(globalThis[marker], undefined, 'Replaced source must never execute');
  git(host, ['checkout', '--force', '--detach', a]);
  assert.equal(realGit(host, ['replace', '-l']).toString().trim(), a, 'Synthetic replace ref stays present');
  assert.equal((await api.hostModule('payload.mjs')).marker, 'A'); assert.equal(globalThis[marker], 'A');
});

test('status-clean assume-unchanged bytes must still match real Git blobs', async t => {
  const root = await fixture(t); git(root, ['init']); await put(root, 'payload.txt', 'committed\n');
  git(root, ['add', '.']); git(root, ['commit', '-m', 'Synthetic clean tree']); const sha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-index', '--assume-unchanged', 'payload.txt']); await put(root, 'payload.txt', 'masked mutation\n');
  assert.equal(realGit(root, ['status', '--porcelain']).toString().trim(), '');
  await assert.rejects(assertGitWorktree(root, sha), /Actual worktree bytes differ/);
});

test('prepared copy creates independent directories/inodes and scoped writes preserve the input', async t => {
  const root = await fixture(t), app = path.join(root, 'app'), input = path.join(root, 'input');
  await mkdir(app); await put(input, 'src/view.tsx', 'original source\n');
  const boundary = await ensurePlainDirectory(app, '.rdesign/desktop-official-prepared'), output = path.join(boundary, 'synthetic/project');
  const copy = await copyPreparedDirectory(input, output, boundary);
  assert(copy.independentDirectories && copy.independentFileInodes && copy.noAliases);
  assert.notEqual(copy.files[0].identity, copy.inputFiles[0].identity);
  const owned = await ownedPreparedTree(output, app, input);
  await writeOwnedPreparedFile(owned, 'src/view.tsx', 'explicit preview adapter\n');
  assert.equal((await readPlainFile(input, 'src/view.tsx')).bytes.toString(), 'original source\n');
  await assert.rejects(copyPreparedDirectory(input, output, boundary), error => error.code === 'EEXIST');
});

test('root/ancestor/child symlinks are rejected without copying or modifying the original', async t => {
  const root = await fixture(t), app = path.join(root, 'app'), input = path.join(root, 'input');
  await mkdir(app); await put(input, 'src/view.tsx', 'untouched\n');
  const boundary = await ensurePlainDirectory(app, '.rdesign/desktop-official-prepared');
  const alias = path.join(root, 'input-alias'); await symlink(input, alias, 'dir');
  for (const [index, source] of [alias, path.join(alias, 'src')].entries()) {
    const output = path.join(boundary, `rejected-input-${index}`);
    await assert.rejects(copyPreparedDirectory(source, output, boundary), /root\/ancestor|alias/); await missing(output);
  }
  const destinationAlias = path.join(boundary, 'destination-alias'); await symlink(input, destinationAlias, 'dir');
  await assert.rejects(copyPreparedDirectory(input, path.join(destinationAlias, 'should-not-exist'), boundary), /root\/ancestor|alias/);
  await missing(path.join(input, 'should-not-exist'));
  await assert.rejects(ownedPreparedTree(destinationAlias, app, input), /root\/ancestor|alias/);
  await assert.rejects(ownedPreparedTree(path.join(destinationAlias, 'src'), app, input), /root\/ancestor|alias/);
  await symlink(path.join(input, 'src/view.tsx'), path.join(input, 'child-alias'));
  await assert.rejects(copyPreparedDirectory(input, path.join(boundary, 'rejected-child'), boundary), /symlinks/);
  await missing(path.join(boundary, 'rejected-child'));
  assert.equal(await readFile(path.join(input, 'src/view.tsx'), 'utf8'), 'untouched\n');
});

test('owned adapter writes reject a swapped leaf hardlink before truncating the shared source', async t => {
  const root = await fixture(t), app = path.join(root, 'app'), input = path.join(root, 'input');
  await mkdir(app); await put(input, 'src/view.tsx', 'untouched\n');
  const boundary = await ensurePlainDirectory(app, '.rdesign/desktop-official-prepared'), output = path.join(boundary, 'copy');
  await copyPreparedDirectory(input, output, boundary); const owned = await ownedPreparedTree(output, app, input);
  await rm(path.join(output, 'src/view.tsx')); await link(path.join(input, 'src/view.tsx'), path.join(output, 'src/view.tsx'));
  await assert.rejects(writeOwnedPreparedFile(owned, 'src/view.tsx', 'must not write'), /alias\/shared inode/);
  assert.equal(await readFile(path.join(input, 'src/view.tsx'), 'utf8'), 'untouched\n');
});

test('actual responsive-adapter CLI rejects prepared root/ancestor aliases before touching the source', async t => {
  const root = await fixture(t), app = path.join(root, 'app'), input = path.join(root, 'input');
  const relative = 'projects/R-ShareMouse/tooling/';
  await put(input, 'src/view.tsx', 'untouched\n'); await mkdir(app);
  const boundary = await ensurePlainDirectory(app, '.rdesign/desktop-official-prepared');
  await symlink(input, path.join(boundary, 'alias'), 'dir');
  await put(app, relative + 'engineering-guards.mjs', await readFile(path.join(tooling, 'engineering-guards.mjs')));
  await put(app, relative + 'apply-sharemouse-responsive.mjs', await readFile(path.join(tooling, 'apply-sharemouse-responsive.mjs')));
  await put(app, relative + 'frozen-host.mjs', `export const repoRoot = ${JSON.stringify(app)}; export const frozenSha = ${JSON.stringify(frozenSha)};\n`);
  for (const preparedDirectory of ['.rdesign/desktop-official-prepared/alias', '.rdesign/desktop-official-prepared/alias/src']) {
    await put(app, 'projects/R-ShareMouse/official-packing.config.json', JSON.stringify({ repositoryUrl: 'https://github.com/a1112/R-ShareMouse', repositoryRoot: '../input', preparedDirectory }));
    const run = spawnSync(process.execPath, [relative + 'apply-sharemouse-responsive.mjs'], { cwd: app, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 1); assert.match(run.stderr, /root\/ancestor|alias/);
    assert.equal(await readFile(path.join(input, 'src/view.tsx'), 'utf8'), 'untouched\n');
  }
});

test('metadata writes reject leaf aliases and keep their external targets unchanged', async t => {
  const root = await fixture(t); await put(root, 'external.txt', 'untouched\n'); await mkdir(path.join(root, 'metadata'));
  await symlink(path.join(root, 'external.txt'), path.join(root, 'metadata/summary.json'));
  await assert.rejects(writePlainFile(path.join(root, 'metadata'), 'summary.json', '{}'), error => error.code === 'ELOOP');
  assert.equal(await readFile(path.join(root, 'external.txt'), 'utf8'), 'untouched\n');
});

async function legacyFixture(t) {
  const root = await fixture(t), relative = 'projects/R-ShareMouse/tooling/';
  await put(root, 'package.json', JSON.stringify({ type: 'module' }));
  await put(root, relative + 'prepare.mjs', `export const repoRoot = ${JSON.stringify(root)};\n`);
  await put(root, 'projects/R-ShareMouse/prepared-packing.config.json', JSON.stringify({ repositoryRoot: '.', preparedDirectory: 'prepared', provenanceFile: 'ledger.json' }));
  await put(root, 'prepared/package.json', JSON.stringify({ dependencies: {} }));
  await put(root, 'prepared/ledger.json', JSON.stringify({ stagedFiles: [], splitResources: [] }));
  await symlink(path.join(frozenRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return { root, relative };
}
test('real check-packing exits nonzero on a throwing packer and failed preflight; no bundle is written', async t => {
  for (const mode of ['throw', 'preflight']) {
    const { root, relative } = await legacyFixture(t);
    await put(root, relative + 'check-packing.ts', await readFile(path.join(tooling, 'check-packing.ts')));
    const pack = mode === 'throw' ? "throw Object.assign(new Error('Synthetic official packing failure'), { code: 'SYNTHETIC_PACKING_FAILED' });" : "return { checksum: 'synthetic' };";
    await put(root, relative + 'frozen-host.mjs', `export const frozenSha = ${JSON.stringify(frozenSha)};
      export async function hostModule(file) {
        if (file.endsWith('/prepared-engineering.ts')) return { packPreparedEngineeringBundle: async () => { ${pack} } };
        if (file.endsWith('/engineering.ts')) return { preflightEngineeringBundle: () => ({ passed: false }) };
        if (file.endsWith('/runtime-dependencies.ts')) return { REVIEWED_RUNTIME_DEPENDENCIES: {}, CORE_PROJECT_DEPENDENCIES: new Set() };
        return { isPrivateSourceName: () => false };
      }\n`);
    const run = spawnSync(process.execPath, ['--import', loader, relative + 'check-packing.ts', 'R-ShareMouse'], { cwd: root, encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 1, run.stderr); assert.equal(run.signal, null);
    const report = JSON.parse(await readFile(path.join(root, 'projects/R-ShareMouse/prepared-packing-summary.json'), 'utf8'));
    assert.equal(report.packing.status, 'blocked'); assert.equal(report.packing.code, mode === 'throw' ? 'SYNTHETIC_PACKING_FAILED' : 'PREFLIGHT_FAILED');
    await missing(path.join(root, '.rdesign/desktop-deliverables/R-ShareMouse.prepared.rdesign-project.json'));
  }
});

test('real recheck stops before candidate generation even if a blocked packing subprocess exits zero', async t => {
  const { root, relative } = await legacyFixture(t);
  await put(root, relative + 'recheck.mjs', await readFile(path.join(tooling, 'recheck.mjs')));
  await put(root, relative + 'frozen-host.mjs', `export const frozenSha = ${JSON.stringify(frozenSha)};\n`);
  await put(root, relative + 'verify.ts', "export {};\n");
  await put(root, relative + 'check-packing.ts', `import { writeFile } from 'node:fs/promises';
    await writeFile('projects/R-ShareMouse/prepared-packing-summary.json', JSON.stringify({ name: 'R-ShareMouse', toolSha: ${JSON.stringify(frozenSha)}, packing: { status: 'blocked' } }));\n`);
  await put(root, relative + 'generate-candidate.ts', "import { writeFile } from 'node:fs/promises'; await writeFile('candidate-should-not-exist', 'incorrect continuation');\n");
  const run = spawnSync(process.execPath, [relative + 'recheck.mjs', 'R-ShareMouse'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 1, run.stderr); assert.equal(run.signal, null);
  await missing(path.join(root, 'candidate-should-not-exist'));
  const report = JSON.parse(await readFile(path.join(root, '.rdesign/desktop-recheck/R-ShareMouse/report.json'), 'utf8'));
  assert.equal(report.projects[0].operations.length, 2); assert.equal(report.projects[0].operations[1].code, 0);
  assert.equal(report.projects[0].operations[1].packingEvidence, 'blocked');
});
