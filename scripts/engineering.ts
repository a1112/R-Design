import { readFile, writeFile } from 'node:fs/promises';
import { generateEngineeringBundle, preflightEngineeringBundle, type EngineeringConfig } from '../packages/project-workspace/src/engineering.js';

const [command, input, output, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !input || !['generate', 'preflight'].includes(command) || (command === 'generate' && !output)) throw new Error('用法: npm run engineering -- generate <config.json> <project.rdesign.json> | preflight <project.rdesign.json>');
  const value = JSON.parse(await readFile(input, 'utf8'));
  const bundle = command === 'generate' ? await generateEngineeringBundle(value as EngineeringConfig) : value;
  const report = preflightEngineeringBundle(bundle);
  if (command === 'generate') await writeFile(output, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
