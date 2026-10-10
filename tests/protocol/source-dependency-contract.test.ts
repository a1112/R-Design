import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateEngineeringBundle, preflightEngineeringBundle, type EngineeringConfig } from '../../packages/project-workspace/src/engineering';
import { packPreparedEngineeringBundle } from '../../packages/project-workspace/src/prepared-engineering';
import { ProjectWorkspace, projectPackage, validatePortableProjectBundle } from '../../packages/project-workspace/src/index';
import { DocumentStore, digest } from '../../packages/document-core/src/index';

const run = promisify(execFile), directories: string[] = [];
const host = path.resolve(import.meta.dirname, '../..');
const groups = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const prefixes = ['', '^', '~'] as const;
// Literal expected versions make an accidental registry update visible to this contract test.
const versions = {
  '@radix-ui/react-dialog': '1.1.23', '@radix-ui/react-dropdown-menu': '2.1.24',
  '@radix-ui/react-select': '2.3.7', '@radix-ui/react-slot': '1.3.3',
  '@radix-ui/react-tooltip': '1.2.8', 'class-variance-authority': '0.7.1', 'date-fns': '3.6.0',
};
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function sourceFixture(group: typeof groups[number], declarations: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-source-dependency-')); directories.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  const imports = Object.keys(versions).map((name, index) => `import * as control${index} from '${name}';`).join('\n');
  await writeFile(path.join(root, 'src/main.tsx'), `import React from 'react';\nimport {createRoot} from 'react-dom/client';\n${imports}\ncreateRoot(document.getElementById('root')!).render(<h1 data-rdesign-id="contract-title">${Object.keys(versions).map((_, index) => `{typeof control${index}}`).join(' ')}</h1>);`);
  await run('git', ['init', root]);
  const config: EngineeringConfig = { repositoryRoot: root, repositoryUrl: 'https://github.com/example/dependency-contract', commit: '', frontendDirectory: '.', name: 'Dependency contract fixture', limitations: ['Synthetic declarations only; no application or backend acceptance'], scenarios: [{ id: 'main', name: 'Main', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="contract-title"]', steps: [], dependencies: ['src/main.tsx'], status: 'unverified' }] };
  async function commit(dependencies: Record<string, string>) {
    const original: Record<string, unknown> = { type: 'module', dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, scripts: { postinstall: 'exit 99', build: 'exit 99' } };
    if (group === 'dependencies') Object.assign(original.dependencies!, dependencies);
    else original[group] = dependencies;
    await writeFile(path.join(root, 'package.json'), JSON.stringify(original));
    await run('git', ['-C', root, 'add', 'index.html', 'src/main.tsx', 'package.json']);
    await run('git', ['-C', root, '-c', 'user.name=Dependency Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic declarations']);
    config.commit = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  }
  await commit(declarations);
  return { root, config, commit };
}

describe('source normalization versus exact-only portable dependency entries', () => {
  it.each(groups.flatMap(group => prefixes.map(prefix => [group, prefix] as const)))('normalizes seven imported %s declarations with prefix "%s" to fixed host versions', async (group, prefix) => {
    const declarations = Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, prefix + version]));
    const { root, config } = await sourceFixture(group, declarations);
    const originalPackage = await readFile(path.join(root, 'package.json'), 'utf8');
    const bundle = await generateEngineeringBundle(config);
    const normalized = JSON.parse(bundle.sourceFiles.find(file => file.path === 'package.json')!.content);
    const origin = JSON.parse(bundle.sourceFiles.find(file => file.path === 'src/rdesign-origin.json')!.content);
    for (const [name, version] of Object.entries(versions)) {
      expect(normalized.dependencies[name]).toBe(version);
      expect(origin.runtimeDependencies[name]).toBe(version);
    }
    expect(normalized.scripts).toEqual({ dev: 'vite --host 127.0.0.1', build: 'vite build' });
    expect(normalized).not.toHaveProperty('devDependencies'); expect(normalized).not.toHaveProperty('optionalDependencies');
    expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    expect(origin.runtimeDependencies).toEqual(normalized.dependencies);
    expect(origin).not.toHaveProperty('originalDependencyDeclarations');
    expect(origin.sourceFiles.find((file: any) => file.file === 'package.json').gitBlobSha).toBe((await run('git', ['--no-replace-objects', '-C', root, 'rev-parse', `${config.commit}:package.json`])).stdout.trim());
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(originalPackage);
    await expect(access(path.join(root, 'node_modules'))).rejects.toThrow();
  });

  it.each(groups)('rejects other source versions, ranges and aliases for each imported package in %s', async group => {
    const { config, commit } = await sourceFixture(group, versions);
    for (const [name, version] of Object.entries(versions)) {
      const [major, minor, patch] = version.split('.').map(Number);
      const lowerBase = patch > 0 ? `${major}.${minor}.${patch - 1}` : `${major}.${minor - 1}.0`;
      // This caret interval includes the host version, but its literal base is unregistered.
      const rejected = ['^' + lowerBase, '0.0.0', '^0.0.0', '~0.0.0', '>=' + version, '<=' + version, '>' + version, '<' + version, version.split('.')[0] + '.x', '*', version + ' || 999.0.0', version + ' - 999.0.0', 'v' + version, ' ' + version, '^^' + version, 'npm:' + name + '@' + version];
      for (const specification of rejected) {
        await commit({ ...versions, [name]: specification });
        await expect(generateEngineeringBundle(config)).rejects.toMatchObject({ code: 'ENGINEERING_DEPENDENCY' });
      }
    }
  }, 120000);

  it.each(groups)('keeps raw ^, ~ and alias specifications in %s rejected by package, bundle import and prepared packing', async group => {
    const { root, config } = await sourceFixture('dependencies', versions);
    const exactBundle = await generateEngineeringBundle(config);
    const seed = await new DocumentStore(path.join(root, 'seed')).load('test');
    const catalog = await new ProjectWorkspace(path.join(root, 'catalog'), root, host).load(seed.project);
    const originalEntry = await readFile(path.join(root, 'src/main.tsx'), 'utf8');
    const prepared = path.join(root, 'prepared');
    for (const file of exactBundle.sourceFiles) {
      await mkdir(path.dirname(path.join(prepared, file.path)), { recursive: true });
      await writeFile(path.join(prepared, file.path), file.content);
    }
    const adaptedEntry = exactBundle.sourceFiles.find(file => file.path === 'src/main.tsx')!.content;
    const provenanceFile = 'src/contract-provenance.json';
    await writeFile(path.join(prepared, provenanceFile), JSON.stringify({ schemaVersion: 1, source: { repository: 'example/dependency-contract', commit: config.commit }, stagedFiles: [{ sourcePath: 'src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(originalEntry), sha256: digest(adaptedEntry) }], splitResources: [] }));
    const preparedConfig = { ...config, preparedDirectory: prepared, provenanceFile };
    // Establish that the same otherwise valid formal bundle and prepared tree are accepted with exact versions.
    await catalog.import(exactBundle);
    expect(preflightEngineeringBundle(await packPreparedEngineeringBundle(preparedConfig)).passed).toBe(true);
    for (const [name, version] of Object.entries(versions)) {
      for (const specification of ['^' + version, '~' + version, 'npm:' + name + '@' + version]) {
        expect(() => projectPackage({ [name]: specification })).toThrow();
        const changed = structuredClone(exactBundle), packageFile = changed.sourceFiles.find(file => file.path === 'package.json')!;
        const declaration = JSON.parse(packageFile.content);
        delete declaration.dependencies[name]; declaration[group] = { ...declaration[group], [name]: specification };
        packageFile.content = JSON.stringify(declaration); packageFile.sha256 = digest(packageFile.content);
        const { checksum: _checksum, ...payload } = changed; changed.checksum = digest(JSON.stringify(payload));
        expect(() => validatePortableProjectBundle(changed)).toThrow();
        await expect(catalog.import(changed)).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
        await writeFile(path.join(prepared, 'package.json'), packageFile.content);
        await expect(packPreparedEngineeringBundle(preparedConfig)).rejects.toMatchObject({ code: 'IMPORT_CONFIG' });
      }
    }
  }, 30000);
});
