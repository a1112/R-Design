import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { projectPackage } from '../../packages/project-workspace/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const main = `import React from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';
function App(){return <main><textarea aria-label="quoted" defaultValue="First line&#10;  indented line"/><textarea aria-label="expression" defaultValue={'First line\\n  indented line'}/><textarea aria-label="single" defaultValue="First  line"/></main>}
createRoot(document.getElementById('root')!).render(<App/>);installRuntime();`;

it('retains actual textarea line breaks and indentation through the React 18 preview', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-textarea-semantics-'));
  const runtime = new BrowserRuntime(root, host);
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage({}, 'react18')));
    await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(root, 'src/main.tsx'), main);
    await runtime.build(); await runtime.start();
    for (const label of ['quoted', 'expression']) expect(await runtime.page.getByLabel(label).inputValue()).toBe('First line\n  indented line');
    expect(await runtime.page.getByLabel('single').inputValue()).toBe('First  line');
    expect(await runtime.page.getByLabel('quoted').getAttribute('data-rdesign-id')).toMatch(/^source-/);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
