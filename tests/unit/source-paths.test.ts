import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { trackedFiles, indexSources, codeHash } from '../../packages/source-binding/src/index';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('tracks nested files with portable paths and discovers editable source on every host',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rd-portable-paths-'));roots.push(root);
  await mkdir(path.join(root,'src','pages'),{recursive:true});
  await writeFile(path.join(root,'src','pages','App.tsx'),'export const App=()=> <button data-rdesign-id="primary" style={{borderRadius:8}}>开始</button>;');
  expect(await trackedFiles(root)).toEqual(['src/pages/App.tsx']);
  const entry=(await indexSources(root)).get('primary')?.[0];
  expect(entry?.binding.file).toBe('src/pages/App.tsx');
  expect(entry?.binding.editableProperties).toContain('text');
  const before=await codeHash(root);
  await writeFile(path.join(root,'src','pages','App.tsx'),'export const App=()=> <button data-rdesign-id="primary" style={{borderRadius:8}}>运行</button>;');
  expect(await codeHash(root)).not.toBe(before);
});
