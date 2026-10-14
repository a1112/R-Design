import { expect,it } from 'vitest';
import { mkdtemp,mkdir,writeFile,symlink,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, normalizePath } from 'vite';
import { fileBoundary } from '../../apps/bridge/src/vite-security';
it('blocks canonical symlink escapes on static and @fs routes while serving ordinary authorized assets',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'rd-vite-boundary-'));const root=path.join(temporary,'workspace');await mkdir(path.join(root,'public'),{recursive:true});await mkdir(path.join(root,'.rdesign'));await mkdir(path.join(root,'private-cache'));await writeFile(path.join(temporary,'outside.txt'),'private external data');await symlink(path.join(temporary,'outside.txt'),path.join(root,'public/asset.txt'));await writeFile(path.join(root,'safe.txt'),'authorized');await writeFile(path.join(root,'test.pem'),'private certificate');await writeFile(path.join(root,'.rdesign/project.json'),'private journal');await writeFile(path.join(root,'private-cache/project.json'),'private cache');
  const server=await createServer({configFile:false,root,publicDir:false,plugins:[fileBoundary({root,allow:[root],privateRoots:[path.join(root,'private-cache')]})],server:{host:'127.0.0.1',port:0,ws:false,hmr:false,fs:{allow:[root]}},logLevel:'silent'});
  try{await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('server missing');const base=`http://127.0.0.1:${address.port}`;const allowed=await fetch(base+'/safe.txt');expect(allowed.status).toBe(200);expect(await allowed.text()).toBe('authorized');for(const url of ['/public/asset.txt','/@fs/'+normalizePath(path.join(root,'public/asset.txt')),'/test.pem','/.rdesign/project.json','/private-cache/project.json','/@fs/'+normalizePath(path.join(root,'private-cache/project.json'))])expect((await fetch(base+url)).status,url).toBe(403);}
  finally{await server.close();await rm(temporary,{recursive:true,force:true});}
});
