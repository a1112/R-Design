import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './prepare.mjs';
import { frozenSha } from './frozen-host.mjs';

const names = process.argv.slice(2);
if (!names.length || names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error('Pass explicit project directory names');
const report = { hostSha: frozenSha, mode: 'isolated source preview and full candidate generation; official packing/import results remain separate', projects: [] };
const logs = path.join(repoRoot, '.rdesign/desktop-recheck', names.join('_'));
await mkdir(logs, { recursive: true });
for (const name of names) {
  const evidence = { name, operations: [] }; report.projects.push(evidence);
  for (const [script, args] of [['verify.ts', [name]], ['check-packing.ts', [name]], ['generate-candidate.ts', [name]]]) {
    const log = path.join(logs, `${name}-${script}.log`), handle = await open(log, 'w', 0o600);
    const child = spawn(process.execPath, ['--import', 'tsx', `projects/R-ShareMouse/tooling/${script}`, ...args], { cwd: repoRoot, stdio: ['ignore', handle.fd, handle.fd] });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await handle.close();
    evidence.operations.push({ script, code, log }); console.log(JSON.stringify({ name, script, code }));
    if (code !== 0) { process.exitCode = 1; break; }
    if (script === 'check-packing.ts') {
      try {
        const packing = JSON.parse(await readFile(path.join(repoRoot, 'projects', name, 'prepared-packing-summary.json'), 'utf8'));
        if (packing.name !== name || packing.toolSha !== frozenSha || packing.packing?.status !== 'passed' || packing.packing?.preflight?.passed !== true) throw new Error('Official packing evidence did not pass for this project and host');
        evidence.operations.at(-1).packingEvidence = 'passed';
      } catch (error) {
        evidence.operations.at(-1).packingEvidence = 'blocked';
        evidence.operations.at(-1).detail = error.message;
        process.exitCode = 1; break;
      }
    }
  }
  await writeFile(path.join(logs, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
