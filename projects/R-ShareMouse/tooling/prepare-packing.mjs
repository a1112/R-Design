import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './prepare.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Explicit recipe for the parent's pack-prepared API. No host policy changes. */
export async function preparePackingRecipe(root, config) {
  const provenance = JSON.parse(await readFile(path.join(root, 'src/rdesignProvenance.json'), 'utf8'));
  const sourceRoot = path.resolve(repoRoot, '../sources', config.name);
  const git = file => execFileSync('git', ['--no-replace-objects', 'show', `${config.source.sha}:${file}`], { cwd: sourceRoot, maxBuffer: 24 * 1024 * 1024 });
  const stagedFiles = [], splitResources = [], covered = new Set();
  for (const mapping of provenance.mappings) {
    const original = git(mapping.upstream);
    assert.equal(digest(original), mapping.sha256, 'Committed source digest must match the capture inventory');
    if (Array.isArray(mapping.adapted)) continue;
    // The upstream entry was moved; src/main.tsx is the generated SDK boundary.
    const file = mapping.adapted === 'src/main.tsx' ? 'src/upstreamMain.tsx' : mapping.adapted;
    const preserved = provenance.stylesheetAdaptations?.find(item => item.original === file)?.preserved;
    for (const target of [file, ...(preserved ? [preserved] : [])]) {
      const bytes = await readFile(path.join(root, target));
      stagedFiles.push({ path: target, sourcePath: mapping.upstream, sourceSha256: mapping.sha256, sha256: digest(bytes) });
      covered.add(target);
    }
  }
  for (const resource of provenance.assetSegments) {
    const decoded = [], chunks = [];
    for (const segment of resource.segments) {
      const encoded = await readFile(path.join(root, segment), 'utf8');
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(bytes.toString('base64'), encoded, 'Every segment must use canonical base64');
      decoded.push(bytes);
      // The packer checks JSON chunks; preserve the original raw-text chunks
      // used by the real application's asset URL adapter alongside them.
      const chunk = segment.replace(/\.txt$/, '.json');
      await writeFile(path.join(root, chunk), JSON.stringify({ base64: encoded }) + '\n');
      chunks.push(chunk); covered.add(chunk); covered.add(segment);
    }
    const bytes = Buffer.concat(decoded);
    assert.equal(bytes.length, resource.bytes); assert.equal(digest(bytes), resource.sha256);
    assert(bytes.equals(git(resource.upstream)), 'Resource reconstruction must equal the committed Git bytes');
    splitResources.push({ file: resource.upstream, bytes: resource.bytes, sha256: resource.sha256, chunks });
  }
  const generatedFiles = [];
  async function visit(directory) {
    for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
      if (item.name.startsWith('.') || ['node_modules', 'dist'].includes(item.name)) continue;
      const file = directory ? `${directory}/${item.name}` : item.name;
      if (item.isDirectory()) { if (directory || item.name === 'src') await visit(file); }
      else if (item.isFile() && !covered.has(file) && (directory || ['index.html', 'package.json'].includes(file))) generatedFiles.push({ path: file, sha256: digest(await readFile(path.join(root, file))), kind: 'explicit adapter output; semantic verification recorded separately' });
    }
  }
  await visit('');
  const provenanceFile = 'src/rdesignPackingLedger.json';
  const ledger = { schemaVersion: 1, source: { repository: config.source.repository, commit: config.source.sha }, stagedFiles, splitResources, generatedFiles, capturedScope: config.copy, omittedFiles: provenance.omitted, nativeAndBackend: 'unavailable; fixture capabilities are explicitly limited; no backend/native success is asserted' };
  await writeFile(path.join(root, provenanceFile), JSON.stringify(ledger, null, 2) + '\n');
  const recipe = { repositoryRoot: `../sources/${config.name}`, repositoryUrl: `https://github.com/${config.source.repository}`, commit: config.source.sha, preparedDirectory: `.rdesign/desktop-prepared/${config.name}`, provenanceFile, name: `${config.name} · 完整前端设计工程`, scenarios: config.scenarios, limitations: config.limitations };
  await writeFile(path.join(repoRoot, 'projects', config.name, 'prepared-packing.config.json'), JSON.stringify(recipe, null, 2) + '\n');
  return { recipe: `projects/${config.name}/prepared-packing.config.json`, provenanceFile, committedBytesAndAdaptedHashes: 'passed independent check; official packer has a separate result', stagedFiles: stagedFiles.length, splitResources: splitResources.length, generatedFiles: generatedFiles.length };
}
