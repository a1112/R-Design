import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './prepare.mjs';
import { frozenSha, hostModule } from './frozen-host.mjs';

const { packPreparedEngineeringBundle } = await hostModule('packages/project-workspace/src/prepared-engineering.ts');
const { preflightEngineeringBundle } = await hostModule('packages/project-workspace/src/engineering.ts');
const { REVIEWED_RUNTIME_DEPENDENCIES, CORE_PROJECT_DEPENDENCIES } = await hostModule('packages/project-workspace/src/runtime-dependencies.ts');
const { isPrivateSourceName } = await hostModule('packages/project-workspace/src/index.ts');
for (const name of process.argv.slice(2)) {
  const project = path.join(repoRoot, 'projects', name);
  const recipe = JSON.parse(await readFile(path.join(project, 'prepared-packing.config.json'), 'utf8'));
  const root = path.resolve(repoRoot, recipe.preparedDirectory);
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const ledger = JSON.parse(await readFile(path.join(root, recipe.provenanceFile), 'utf8'));
  const dependencyGaps = Object.entries(manifest.dependencies).filter(([dependency, version]) => !CORE_PROJECT_DEPENDENCIES.has(dependency) && REVIEWED_RUNTIME_DEPENDENCIES[dependency] !== version).map(([dependency, version]) => ({ dependency, actualVerifiedVersion: version, registeredVersion: REVIEWED_RUNTIME_DEPENDENCIES[dependency] ?? null }));
  const provenancePathGaps = [...new Set([...ledger.stagedFiles.map(file => file.sourcePath), ...ledger.splitResources.map(file => file.file)])].filter((file: string) => file.split('/').some(isPrivateSourceName));
  const report: any = { name, toolSha: frozenSha, mergedIntoMain: false, dependencyGaps, provenancePathGaps, sourceAndResourceLedger: { stagedFiles: ledger.stagedFiles.length, splitResources: ledger.splitResources.length, independentGitByteCheck: 'passed by prepare-packing; actual packer result below' } };
  try {
    const bundle = await packPreparedEngineeringBundle({ ...recipe, repositoryRoot: path.resolve(repoRoot, recipe.repositoryRoot), preparedDirectory: root });
    const preflight = preflightEngineeringBundle(bundle);
    const output = path.join(repoRoot, '.rdesign/desktop-deliverables', `${name}.prepared.rdesign-project.json`);
    await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    report.packing = { status: 'passed', output, checksum: bundle.checksum, preflight };
  } catch (error) {
    report.packing = { status: 'blocked', code: (error as any).code ?? 'PACKING_FAILED', detail: (error as Error).message };
  }
  await writeFile(path.join(project, 'prepared-packing-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ name, toolSha: frozenSha, packing: report.packing, unregisteredDependencies: dependencyGaps.length, provenancePathGaps }));
}
