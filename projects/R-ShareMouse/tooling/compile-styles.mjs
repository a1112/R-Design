import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { repoRoot } from './prepare.mjs';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('./dependencies/package.json', import.meta.url));

export async function compileStyles(root, config) {
  const original = path.join(root, config.styles);
  const css = await readFile(original, 'utf8');
  let output;
  if (config.tailwind === 3) {
    const postcss = require('postcss');
    const tailwind3 = require('tailwind3');
    output = (await postcss([tailwind3({ ...config.tailwindConfig, content: [path.join(root, 'index.html'), path.join(root, 'src/**/*.{ts,tsx,js,jsx,mjs}')], plugins: [] })]).process(css, { from: original })).css;
  } else {
    const { compile } = await import(require.resolve('@tailwindcss/node'));
    const { Scanner } = await import(require.resolve('@tailwindcss/oxide'));
    const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{js,ts,jsx,tsx,mjs}', negated: false }] });
    const compiler = await compile(css, { base: path.dirname(original), onDependency() {} });
    output = compiler.build(scanner.scan());
  }
  // CSS is precompiled without importing any upstream executable configuration.
  await writeFile(path.join(root, 'src/rdesign.compiled.css'), output);
  const archives = [];
  async function preserveInputs(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await preserveInputs(absolute);
      else if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'rdesign.compiled.css') {
        const input = await readFile(absolute, 'utf8');
        if (/@tailwind\b|@import\s+["']tailwindcss/.test(input)) {
          // Keep complete original stylesheet text. The executable CSS path carries
          // its already compiled equivalent rather than unsupported Tailwind input.
          await writeFile(absolute + '.source.txt', input);
          await writeFile(absolute, output);
          archives.push({ original: path.relative(root, absolute), preserved: path.relative(root, absolute) + '.source.txt', sha256: createHash('sha256').update(input).digest('hex') });
        }
      }
    }
  }
  await preserveInputs(path.join(root, 'src'));
  const provenancePath = path.join(root, 'src/rdesignProvenance.json');
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  provenance.stylesheetAdaptations = archives;
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
  const main = path.join(root, 'src/upstreamMain.tsx');
  let source = await readFile(main, 'utf8');
  const expected = './' + config.styles.slice('src/'.length);
  if (!source.includes(expected)) throw new Error(`Missing source CSS entry ${expected}`);
  source = source.replace(expected, './rdesign.compiled.css');
  await writeFile(main, source);
  return { source: config.styles, output: 'src/rdesign.compiled.css', bytes: Buffer.byteLength(output), preservedOriginalInputs: archives, compiler: config.tailwind === 3 ? 'tailwindcss@3.4.17' : '@tailwindcss/node@4.1.12' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  const config = JSON.parse(await readFile(path.join(repoRoot, 'projects', name, 'adapter.json'), 'utf8'));
  console.log(JSON.stringify(await compileStyles(path.join(repoRoot, '.rdesign/desktop-prepared', name), config)));
}
