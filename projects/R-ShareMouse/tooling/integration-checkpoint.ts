import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { repoRoot, runtimeDependencies } from './prepare.mjs';
import { dependencyRoot, dependencyAliases } from './dependencies.mjs';
import { frozenSha, frozenRoot, hostModule } from './frozen-host.mjs';

const { generateEngineeringBundle } = await hostModule('packages/project-workspace/src/engineering.ts');
const { REVIEWED_RUNTIME_DEPENDENCIES } = await hostModule('packages/project-workspace/src/runtime-dependencies.ts');
const projects = ['R-ShareMouse', 'R-Link'];
const merged: Record<string, any> = {};
async function files(root: string): Promise<string[]> {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}
for (const name of projects) {
  const projectRoot = path.join(repoRoot, 'projects', name), sourceRoot = path.resolve(repoRoot, '../sources', name), prepared = path.join(repoRoot, '.rdesign/desktop-prepared', name);
  const adapter = JSON.parse(await readFile(path.join(projectRoot, 'adapter.json'), 'utf8'));
  const git = (...args: string[]) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
  if (git('rev-parse', 'HEAD') !== adapter.source.sha || git('status', '--porcelain', '--untracked-files=no') || git('for-each-ref', '--format=%(refname)', 'refs/replace')) throw new Error(`${name}: provenance/clean checkout check failed`);
  const upstreamPackage = JSON.parse(git('show', `${adapter.source.sha}:${adapter.source.frontend === '.' ? '' : adapter.source.frontend + '/'}package.json`));
  const preparedPackage = JSON.parse(await readFile(path.join(prepared, 'package.json'), 'utf8'));
  const production = await runtimeDependencies(prepared, preparedPackage, false);
  const allImports = new Set<string>(), rawTailwind: string[] = [], parseIssues: string[] = [];
  for (const file of await files(path.join(prepared, 'src'))) {
    if (!/\.[cm]?[jt]sx?$|\.css$/.test(file)) continue;
    const content = await readFile(file, 'utf8');
    if (file.endsWith('.css')) {
      if (/@tailwind\b|@import\s+["']tailwindcss/.test(content)) rawTailwind.push(path.relative(prepared, file));
      continue;
    }
    try {
      const ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        let specifier;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source?.type === 'StringLiteral' && node.importKind !== 'type' && node.exportKind !== 'type') specifier = node.source.value;
        if (node.type === 'CallExpression' && node.callee?.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') specifier = node.arguments[0].value;
        if (specifier && !/^(?:\.|\/|data:|https?:|@rdesign\/)/.test(specifier)) allImports.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
        for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) Array.isArray(value) ? value.forEach(visit) : value && typeof value === 'object' && visit(value);
      };
      visit(ast.program);
    } catch { parseIssues.push(path.relative(prepared, file)); }
  }
  const dependencies = [];
  for (const packageName of [...allImports].sort()) {
    if (['react', 'react-dom'].includes(packageName)) continue;
    const installedRoot = path.join(dependencyRoot, dependencyAliases[name]?.[packageName] ?? packageName);
    let installed: any;
    try { installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8')); } catch {}
    const version = preparedPackage.dependencies?.[packageName] ?? installed?.version ?? null;
    const dependency = { package: packageName, version, upstreamRequested: upstreamPackage.dependencies?.[packageName] ?? upstreamPackage.devDependencies?.[packageName] ?? adapter.extraDependencies?.[packageName] ?? null, declaredInCandidate: packageName in (preparedPackage.dependencies ?? {}), reachableFromMain: packageName in production, registeredInFrozenHost: REVIEWED_RUNTIME_DEPENDENCIES[packageName] === version, peerReact: installed?.peerDependencies?.react ?? null };
    dependencies.push(dependency);
    merged[packageName] ??= { package: packageName, versions: [], projects: [], productionProjects: [] };
    if (version && !merged[packageName].versions.includes(version)) merged[packageName].versions.push(version);
    merged[packageName].projects.push(name);
    if (dependency.reachableFromMain) merged[packageName].productionProjects.push(name);
  }
  const probe = { repositoryRoot: `../sources/${name}`, repositoryUrl: `https://github.com/${adapter.source.repository}`, commit: adapter.source.sha, frontendDirectory: adapter.source.frontend, name: `${name} · 原入口兼容性检查`, limitations: adapter.limitations, relocations: Object.entries(adapter.relocations ?? {}).filter(([from]) => from === 'public' || from.startsWith('public/')).map(([from, to]) => ({ from, to })), scenarios: [1440, 390].map(width => ({ id: `original-source-${width}`, name: `原入口兼容性检查 ${width}`, route: '/', viewport: { width, height: width === 390 ? 844 : 900 }, steps: [], readySelector: '#root > *', dependencies: ['src/main.tsx'], status: 'unverified' })) };
  await writeFile(path.join(projectRoot, 'generator-probe-config.json'), JSON.stringify(probe, null, 2) + '\n');
  let generator;
  try { const result = await generateEngineeringBundle({ ...probe, repositoryRoot: sourceRoot }); generator = { status: 'passed structural generation only', checksum: result.checksum }; }
  catch (error) { generator = { status: 'blocked', code: (error as any).code ?? 'GENERATION_FAILED', detail: (error as Error).message.split('\n')[0].slice(0, 600) }; }
  const report = { name, source: adapter.source, testedHostSha: frozenSha, sourceCheckout: 'clean exact committed SHA; no replace refs; read with --no-replace-objects', generatorProbe: generator, probePurpose: 'Original-source compatibility only; this probe is not the adapted application generator config', originalFramework: { react: upstreamPackage.dependencies?.react, 'react-dom': upstreamPackage.dependencies?.['react-dom'] }, adaptedFramework: { react: preparedPackage.dependencies?.react, 'react-dom': preparedPackage.dependencies?.['react-dom'] }, dependencies, sourceModulesMissingCandidateDeclarations: dependencies.filter(dependency => !dependency.declaredInCandidate).map(dependency => dependency.package), rawTailwindInputs: rawTailwind, parseIssues, requiredHostChanges: ['Reviewed dependencies and exact versions for the retained UI modules', 'A reviewed React 18 → 19 compatibility path before the original-package framework gate', 'Explicit support for locally prepared SDK/native preview helpers, compiled CSS and lossless asset segments', ...(dependencies.some(dependency => dependency.package === 'react-day-picker') ? ['react-day-picker@8.10.1 does not declare React 19 peer support; optional calendar is retained and unverified'] : [])], acceptance: { checksumAndFileIntegrity: 'passed candidate bundle', documentAndResourceSchema: 'passed except separately reported dependency policy', frozenPreflight: 'blocked IMPORT_CONFIG', frozenImport: 'blocked IMPORT_CONFIG', originalApplicationPreview: 'passed registered scenes in isolated compatibility rehearsal', nativeBackend: 'unavailable, not validated', officialCandidateAcceptanceAndRevert: 'blocked, not accepted' }, waitingForOwner: 'Follow-up shared-tool SHA for the four reported boundary repairs; no shared files modified' };
  await writeFile(path.join(projectRoot, 'integration-summary.json'), JSON.stringify(report, null, 2) + '\n');
  const preparedSummaryPath = path.join(projectRoot, 'prepared-summary.json'), preparedSummary = JSON.parse(await readFile(preparedSummaryPath, 'utf8'));
  preparedSummary.validation = { schema: 'passed document/resources; package dependency policy blocked', checksum: 'passed full v1 payload and individual files', import: 'blocked frozen IMPORT_CONFIG', runtime: 'passed compatibility rehearsal only', sourceMapping: 'passed controlled literal/static-style mapping; dynamic/shared/canvas read-only', interactions: 'passed registered UI transitions; no backend/native success' };
  await writeFile(preparedSummaryPath, JSON.stringify(preparedSummary, null, 2) + '\n');
  console.log(JSON.stringify({ name, generator, retainedDependencyCount: dependencies.length, missingManifestCount: report.sourceModulesMissingCandidateDeclarations.length, rawTailwindInputs: rawTailwind.length }));
}
await writeFile(path.join(repoRoot, 'projects/R-ShareMouse/dependency-integration-request.json'), JSON.stringify({ testedHostSha: frozenSha, registry: REVIEWED_RUNTIME_DEPENDENCIES, dependencies: Object.values(merged), note: 'This is an explicit compatibility request, not a whitelist change or a claim that unused optional components ran.' }, null, 2) + '\n');
