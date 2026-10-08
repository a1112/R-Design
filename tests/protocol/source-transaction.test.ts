import { afterEach, expect, it } from 'vitest';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChangeEngine } from '../../packages/change-engine/src/index';
import { DocumentStore,digest } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import type { BrowserRuntime } from '../../apps/bridge/src/runtime';
import type { ChangeSet } from '../../packages/protocol/src/index';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('commits accepted/reverted source before runtime work so a reload failure cannot roll back document identity',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rd-source-'));roots.push(root);await mkdir(path.join(root,'src'));const before='export const View=()=> <button data-rdesign-id="start" style={{ borderRadius: 8 }}>开始</button>;\n';const after=before.replace('borderRadius: 8','borderRadius: 12');await writeFile(path.join(root,'src/App.tsx'),before);const store=await new DocumentStore(path.join(root,'.rdesign')).load(await codeHash(root));let runtimeCalls=0;const runtime={root,serial:()=>{runtimeCalls++;throw new Error('runtime build failed');}} as unknown as BrowserRuntime;const engine=new ChangeEngine(store,runtime,root);const id=`change_${randomUUID()}`;const candidate=engine.candidateRoot(id);await mkdir(path.join(candidate,'src'),{recursive:true});await writeFile(path.join(candidate,'src/App.tsx'),after);await mkdir(path.dirname(engine.metadataFile(id)),{recursive:true});await writeFile(engine.metadataFile(id),JSON.stringify({sourceNodeId:'start',file:'src/App.tsx',mutations:[{property:'borderRadius',before:8,after:12}],candidateHash:await codeHash(candidate),candidateFiles:{'src/App.tsx':digest(after)}}));const patches=[{file:'src/App.tsx',before,after,beforeHash:digest(before),afterHash:digest(after)}];const change:ChangeSet={id,projectId:store.project.id,operationId:'prepare-operation',expectedRevision:1,status:'verified',intent:'圆角12',createdAt:new Date().toISOString(),baseCodeRevision:store.project.codeRevision,diffHash:digest(JSON.stringify(patches)),patches,evidence:[{name:'candidate build',passed:true,detail:'passed'}]};store.changes.push(change);
  await store.write({projectId:store.project.id,expectedRevision:1,operationId:'accept-operation'},'accept',()=>engine.apply(id,change.diffHash));expect(store.changes[0].status).toBe('accepted');expect(await readFile(path.join(root,'src/App.tsx'),'utf8')).toBe(after);expect(runtimeCalls).toBe(0);
  await store.write({projectId:store.project.id,expectedRevision:2,operationId:'revert-operation'},'revert',()=>engine.revert(id));expect(store.changes[0].status).toBe('reverted');expect(await readFile(path.join(root,'src/App.tsx'),'utf8')).toBe(before);expect(runtimeCalls).toBe(0);
});
