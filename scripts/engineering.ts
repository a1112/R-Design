import { readFile, writeFile } from 'node:fs/promises';
import { generateEngineeringBundle, preflightEngineeringBundle, type EngineeringConfig } from '../packages/project-workspace/src/engineering.js';
import { packPreparedEngineeringBundle, type PreparedEngineeringConfig } from '../packages/project-workspace/src/prepared-engineering.js';

const [command, input, output, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !input || !['generate', 'pack-prepared', 'preflight'].includes(command) || (command !== 'preflight' && !output)) throw new Error('用法: npm run engineering -- generate|pack-prepared <config.json> <project.rdesign.json> | preflight <project.rdesign.json>');
  const value = JSON.parse(await readFile(input, 'utf8'));
  const bundle = command === 'generate' ? await generateEngineeringBundle(value as EngineeringConfig) : command === 'pack-prepared' ? await packPreparedEngineeringBundle(value as PreparedEngineeringConfig) : value;
  const report = preflightEngineeringBundle(bundle);
  if (command !== 'preflight') await writeFile(output, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
