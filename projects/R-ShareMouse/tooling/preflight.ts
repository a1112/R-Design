import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { digest, DomainError } from '../../../packages/document-core/src/index.js';
import type { PortableProjectBundle } from '../../../packages/project-workspace/src/index.js';
import { repoRoot } from './prepare.mjs';
import { frozenRoot, frozenSha, hostModule } from './frozen-host.mjs';

/** Reuse the actual v1 validation functions in memory, without changing core files. */
export async function preflightBundle(bundle: PortableProjectBundle) {
  const schemaPath = path.join(frozenRoot, 'packages/project-workspace/src/index.ts');
  const registry = await hostModule('packages/project-workspace/src/runtime-dependencies.ts');
  const schemaSource = await readFile(schemaPath, 'utf8');
  const start = schemaSource.indexOf('const MAX_FILE_BYTES =');
  const end = schemaSource.indexOf('export class ProjectWorkspace');
  assert(start >= 0 && end > start, 'The parent schema changed; update this adapter preflight');
  const validationCode = schemaSource.slice(start, end) + '\nexport { assertPortableLayout, assertDocument, fileBytes, validateSource };';
  const compiled = await transform(validationCode, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.code, { module, exports: module.exports, Buffer, path, DomainError, digest, ...registry }, { timeout: 1000, filename: schemaPath });
  const validators = module.exports;
  assert.equal(bundle.format, 'rdesign-project');
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.manifest.schemaVersion, 1);
  assert(bundle.sourceFiles.length > 0 && bundle.sourceFiles.length <= 1000);
  const { checksum, ...payload } = bundle;
  const encoded = JSON.stringify(payload);
  assert(Buffer.byteLength(encoded) <= 24 * 1024 * 1024);
  assert.equal(digest(encoded), checksum);
  validators.assertDocument(bundle.document);
  validators.assertPortableLayout(bundle.sourceFiles.map(file => file.path));
  let binaryFiles = 0;
  let packagePolicy: any = { status: 'passed' };
  for (const file of bundle.sourceFiles) {
    assert.equal(digest(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')), file.sha256);
    try { validators.fileBytes(file); }
    catch (error) {
      if (file.path !== 'package.json' || (error as DomainError).code !== 'IMPORT_CONFIG') throw new DomainError((error as DomainError).code ?? 'PREFLIGHT_FILE', `${file.path}: ${(error as Error).message}`, 400);
      const config = JSON.parse(file.content);
      // Verify scripts and structure independently of the known baseline dependency restriction.
      validators.validateSource(file.path, JSON.stringify({ ...config, dependencies: {}, devDependencies: {}, optionalDependencies: {} }));
      packagePolicy = { status: 'blocked', code: 'IMPORT_CONFIG', dependencies: Object.keys(config.dependencies ?? {}), detail: (error as Error).message };
    }
    if (file.encoding === 'base64') binaryFiles++;
  }
  return {
    frozenHostSha: frozenSha, actualSchemaFileSha256: digest(schemaSource), documentSchema: 'passed', portableLayout: 'passed',
    sourceFileSchema: 'passed except the separately reported package dependency policy',
    credentialAndPrivatePathScan: 'passed', binarySignatures: { status: 'passed', files: binaryFiles },
    perFileIntegrity: 'passed', payloadIntegrity: 'passed', packagePolicy,
  };
}
