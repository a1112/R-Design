import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { assertProfileCoreVersions, runtimeProfileFromPackage } from '../../packages/project-workspace/src/runtime-profiles';
import { reviewedDependency, reviewedRuntimeDependencies } from '../../packages/project-workspace/src/runtime-dependencies';
import { projectPackage, readPortableSourceFiles, ProjectWorkspace } from '../../packages/project-workspace/src/index';
import { generateEngineeringBundle, preflightEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { packPreparedEngineeringBundle } from '../../packages/project-workspace/src/prepared-engineering';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { readRuntimeProfile, profileHostDependencies } from '../../apps/bridge/src/runtime-dependencies';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { injectSourceIds } from '../../packages/runtime-web/src/vite';

const host = path.resolve(import.meta.dirname, '../..'), run = promisify(execFile), roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(os.tmpdir(), 'rd-runtime-profile-')); roots.push(root); return root; }
async function source(profile: 'react18' | 'react19', prepared = false) {
  const root = await directory(); await mkdir(path.join(root, 'src'));
  const version = profile === 'react18' ? '18.3.1' : '19.3.0';
  const main = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{installRuntime}from'@rdesign/runtime-web';
import * as jsxRuntime from 'react/jsx-runtime';
${profile === 'react18' ? "import{createRoot as createThreeRoot}from'@react-three/fiber';import{OrbitControls}from'@react-three/drei';import{REVISION as threeRevision}from'three';import{motion}from'framer-motion';import{Box}from'lucide-react';" : ''}
function App(){const[count,setCount]=useState(0);return <main data-rdesign-ready="true"><h1 data-rdesign-id="profile-title">Synthetic profile</h1><output>{React.version}</output><button onClick={()=>setCount(count+1)}>Count {count}</button><p>JSX runtime {typeof jsxRuntime.jsx}</p>${profile === 'react18' ? '<motion.div data-testid="motion-label" animate={{opacity:1}}>Controlled motion<Box aria-label="Controlled icon"/></motion.div>' : ''}</main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);installRuntime();
${profile === 'react18' ? "document.documentElement.dataset.rendererContract=typeof createThreeRoot+'/'+typeof OrbitControls+'/'+threeRevision;" : ''}`;
  await writeFile(path.join(root, 'src/main.tsx'), prepared ? main : main.replace("import{installRuntime}from'@rdesign/runtime-web';", '').replace('installRuntime();', ''));
  await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  const declaration = projectPackage(profile === 'react18' ? { '@react-three/fiber': '8.18.0', '@react-three/drei': '9.122.0', three: '0.183.2', 'framer-motion': '12.43.0', 'lucide-react': '0.468.0' } : {}, profile);
  await writeFile(path.join(root, 'package.json'), JSON.stringify(declaration));
  await run('git', ['init', root]);
  await run('git', ['-C', root, 'add', '.']);
  await run('git', ['-C', root, '-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic profile']);
  const commit = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  const scenarios = [{ id: 'desktop', name: 'Desktop', route: '/', viewport: { width: 1200, height: 820 }, steps: [], readySelector: '[data-rdesign-ready]', dependencies: ['src/main.tsx'], status: 'unverified' as const }];
  const config = { repositoryRoot: root, repositoryUrl: 'https://github.com/example/synthetic-profile', commit, frontendDirectory: '.', runtimeProfile: profile, name: 'Synthetic runtime profile', limitations: ['Synthetic frontend, no backend'], scenarios };
  if (!prepared) return { root, bundle: await generateEngineeringBundle(config), version };
  const ledger = { schemaVersion: 1, source: { repository: 'example/synthetic-profile', commit }, stagedFiles: [{ sourcePath: 'src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(main), sha256: digest(main) }], splitResources: [] };
  await writeFile(path.join(root, 'src/provenance.json'), JSON.stringify(ledger));
  const bundle = await packPreparedEngineeringBundle({ ...config, preparedDirectory: root, provenanceFile: 'src/provenance.json' });
  return { root, bundle, version };
}

describe('controlled runtime profiles', () => {
  it('preserves the legacy default and admits only exact React 18 declarations', () => {
    expect(runtimeProfileFromPackage({})).toBe('react19');
    expect(projectPackage().dependencies.react).toBe('^19.1.0');
    expect(projectPackage()).not.toHaveProperty('rdesign');
    expect(projectPackage({}, 'react18')).toMatchObject({ rdesign: { runtimeProfile: 'react18' }, dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } });
    expect(reviewedDependency('three', '0.180.0')).toBe(true);
    expect(reviewedDependency('three', '0.183.2')).toBe(false);
    expect(reviewedDependency('three', '0.183.2', 'react18')).toBe(true);
    expect(reviewedDependency('@react-three/fiber', '8.18.0', 'react18')).toBe(true);
    expect(reviewedDependency('react-router-dom', '7.9.3')).toBe(true);
    expect(reviewedDependency('react-router-dom', '7.9.3', 'react18')).toBe(false);
    expect(reviewedDependency('recharts', '2.15.4', 'react18')).toBe(false);
    expect(()=>reviewedRuntimeDependencies('unknown' as any)).toThrow();
  });

  it.each([null, [], {rdesign:null}, {rdesign:[]}, {rdesign:{}}, {rdesign:{runtimeProfile:'react17'}}, {rdesign:{runtimeProfile:'react18', aliases:{react:'outside'}}}, {rdesign:{runtimeProfile:'react18', registry:'https://example.invalid'}}])('rejects unenumerated metadata %#', config => {
    expect(()=>runtimeProfileFromPackage(config)).toThrow();
  });

  it.each(['^18.3.1','18.2.0','19.3.0','*','npm:react@18.3.1','https://example.invalid/react.tgz'])('rejects unpinned or mixed core version %s', version => {
    expect(()=>assertProfileCoreVersions({dependencies:{react:version,'react-dom':'18.3.1'}},'react18')).toThrow();
    expect(()=>assertProfileCoreVersions({dependencies:{react:'18.3.1','react-dom':'18.3.1'},optionalDependencies:{react:version}},'react18')).toThrow();
  });

  it('keeps script, private-content and dependency checks active for profile bundles', async () => {
    const root=await directory(); await mkdir(path.join(root,'src'));
    for(const change of [
      {scripts:{postinstall:'exit 99'}}, {dependencies:{react:'18.3.1','react-dom':'18.3.1',three:'^0.183.2'}},
      {dependencies:{react:'18.3.1','react-dom':'18.3.1','react-router-dom':'7.9.3'}},
      {dependencies:{react:'18.3.1','react-dom':'18.3.1',unknown:'1.0.0'}},
      {rdesign:{runtimeProfile:'react18',path:'../../outside'}},
      {imports:{'#unregistered':'react-router-dom'}},
    ]) {
      await writeFile(path.join(root,'package.json'),JSON.stringify({...projectPackage({},'react18'),...change}));
      await expect(readPortableSourceFiles(root)).rejects.toMatchObject({code:'IMPORT_CONFIG'});
    }
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage({},'react18')));
    await writeFile(path.join(root,'src/demo.ts'),'api_key = "SYNTHETIC_NOT_A_REAL_CREDENTIAL_0123456789"');
    await expect(readPortableSourceFiles(root)).rejects.toMatchObject({code:'IMPORT_SECRET'});
  });

  it('resolves each React major separately and fails closed if host profile packages are missing', async () => {
    const defaults=profileHostDependencies(host,'react19'), alternate=profileHostDependencies(host,'react18');
    expect(defaults.aliases.react).not.toBe(alternate.aliases.react);
    expect(JSON.parse(await readFile(path.join(defaults.aliases.react,'package.json'),'utf8')).version).toBe('19.3.0');
    expect(JSON.parse(await readFile(path.join(alternate.aliases.react,'package.json'),'utf8')).version).toBe('18.3.1');
    expect(JSON.parse(await readFile(path.join(alternate.aliases.three,'package.json'),'utf8')).version).toBe('0.183.2');
    const absent=await directory();
    expect(()=>profileHostDependencies(absent,'react18')).toThrow();
    expect(alternate.sceneIntrinsics?.has('cylinderGeometry')).toBe(true);
    expect(alternate.sceneIntrinsics?.has('shaderMaterial')).toBe(true);
    await mkdir(path.join(absent,'node_modules'),{recursive:true});
    const fakeModules=path.join(absent,'packages/runtime-react18/node_modules');
    await mkdir(path.join(fakeModules,'react'),{recursive:true});
    await writeFile(path.join(fakeModules,'react/package.json'),JSON.stringify({name:'react',version:'18.2.0'}));
    expect(()=>profileHostDependencies(absent,'react18')).toThrow();
  });

  it('rejects metadata symlinks and in-place profile changes', async () => {
    const root=await directory(), outside=await directory();
    await writeFile(path.join(outside,'package.json'),JSON.stringify(projectPackage({},'react18')));
    await symlink(path.join(outside,'package.json'),path.join(root,'package.json'));
    expect(()=>readRuntimeProfile(root)).toThrow();
    await rm(path.join(root,'package.json'));
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage({},'react18')));
    const runtime=new BrowserRuntime(root,host); runtime.config();
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage()));
    expect(()=>runtime.config()).toThrow();
    await expect(runtime.refreshSources()).rejects.toMatchObject({code:'RUNTIME_PROFILE_CHANGED'});
    expect(runtime.status).toBe('build-failed');
  });

  it('does not inject DOM source IDs into React Three scene objects', () => {
    const jsx='const App=()=> <main><button>Reset</button><mesh><boxGeometry/><meshStandardMaterial/><ambientLight/><cylinderGeometry/><shaderMaterial/></mesh></main>';
    const transformed=injectSourceIds(jsx,'/synthetic/src/Scene.tsx','/synthetic',profileHostDependencies(host,'react18').sceneIntrinsics);
    expect((transformed.match(/data-rdesign-id/g)??[]).length).toBe(2);
    expect((injectSourceIds(jsx,'/synthetic/src/Scene.tsx','/synthetic').match(/data-rdesign-id/g)??[]).length).toBe(8);
  });

  it.each([['react18',false],['react18',true],['react19',false]] as const)('retains %s through %s packing, two imports, live/candidate rendering and reload', async (profile, prepared) => {
    const {root,bundle,version}=await source(profile,prepared);
    expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const data=path.join(root,'catalog'),store=await new DocumentStore(data).load('synthetic');
    const catalog=await new ProjectWorkspace(data,root,host).load(store.project);
    for(let i=0;i<2;i++) {
      const imported=await catalog.validate((await catalog.import(bundle)).id);
      expect(readRuntimeProfile(imported.sourceDirectory)).toBe(profile);
      const privateDirectory=path.join(imported.sourceDirectory,'.rdesign/private');
      await mkdir(privateDirectory,{recursive:true});
      await writeFile(path.join(privateDirectory,'fixture.txt'),'SYNTHETIC_PRIVATE_MARKER');
      await writeFile(path.join(imported.sourceDirectory,'.env'),'SYNTHETIC_ENV=fixture-only');
      const outside=path.join(root,'outside.txt');await writeFile(outside,'SYNTHETIC_OUTSIDE_MARKER');
      await symlink(outside,path.join(imported.sourceDirectory,'escape.txt'));
      const runtime=new BrowserRuntime(imported.sourceDirectory,host,i===0?'live':'candidate',0,privateDirectory);
      try {
        await runtime.build(); await runtime.start();
        await runtime.page.locator('[data-rdesign-ready]').waitFor();
        expect(await runtime.page.locator('output').textContent()).toBe(version);
        if(profile==='react18') {
          expect(await runtime.page.locator('html').getAttribute('data-renderer-contract')).toBe('function/object/183');
          expect(await runtime.page.getByTestId('motion-label').textContent()).toBe('Controlled motion');
          expect(await runtime.page.getByLabel('Controlled icon').count()).toBe(1);
        }
        expect(await runtime.page.locator('p').textContent()).toBe('JSX runtime function');
        await runtime.page.getByRole('button').click();
        expect(await runtime.page.getByRole('button').textContent()).toBe('Count 1');
        expect((await runtime.capture()).nodes.find(node=>node.sourceNodeId==='profile-title')?.binding?.reliability).toBe('exact');
        await runtime.page.reload();
        expect(await runtime.page.locator('output').textContent()).toBe(version);
        expect(await runtime.page.getByRole('button').textContent()).toBe('Count 0');
        const response=await runtime.page.request.get(runtime.url()+'/package.json');
        expect(response.ok()).toBe(true);
        expect((await response.json()).scripts).toEqual({dev:'vite --host 127.0.0.1',build:'vite build'});
        for(const forbidden of ['/.env','/.rdesign/private/fixture.txt','/escape.txt']) expect((await runtime.page.request.get(runtime.url()+forbidden)).status()).toBe(403);
      } finally { await runtime.close(); }
    }
  },120000);

  it('blocks package, absolute-file, remote and dynamic import bypasses in a linked React 18 runtime', async () => {
    const root=await directory(); await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage({},'react18')));
    await writeFile(path.join(root,'index.html'),'<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    const forbiddenFile=path.join(host,'node_modules/recharts/es6/index.js');
    await symlink(forbiddenFile,path.join(root,'src/escape.js'));
    const imports=['react-router-dom','recharts','#unregistered',forbiddenFile,'./escape.js','https://example.invalid/module.js','data:text/javascript,export default 1']
      .map(specifier=>`import * as forbidden from ${JSON.stringify(specifier)};console.log(forbidden);`);
    imports.push("const source='https://example.invalid/module.js';import(/* @vite-ignore */source);", "require('recharts');");
    for(const code of imports) {
      await writeFile(path.join(root,'src/main.tsx'),code);
      const runtime=new BrowserRuntime(root,host);
      try { await expect(runtime.build()).rejects.toThrow(); } finally { await runtime.close(); }
    }
  });

  it('rejects linked lifecycle metadata and disables project PostCSS plugins', async () => {
    const root=await directory(); await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'package.json'),JSON.stringify({...projectPackage({},'react18'),scripts:{postinstall:'exit 99'}}));
    expect(()=>readRuntimeProfile(root)).toThrow();
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage({},'react18')));
    await writeFile(path.join(root,'postcss.config.cjs'),"throw new Error('PROJECT_PLUGIN_EXECUTED');");
    await writeFile(path.join(root,'index.html'),'<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(root,'src/main.tsx'),"import './style.css';document.getElementById('root')!.textContent='controlled css';");
    await writeFile(path.join(root,'src/style.css'),'body{color:rgb(10,20,30)}');
    const runtime=new BrowserRuntime(root,host);
    try { expect(runtime.config().css?.postcss.plugins).toEqual([]); await runtime.build(); }
    finally { await runtime.close(); }
  });

  it('blocks HTML script and import-map redirects before a managed preview starts', async () => {
    const root=await directory(); await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'package.json'),JSON.stringify(projectPackage({},'react18')));
    await writeFile(path.join(root,'src/main.tsx'),"document.getElementById('root')!.textContent='local source';");
    for(const extra of [
      '<script type="module" src="https://example.invalid/module.js"></script>',
      '<script src="//example.invalid/module.js"></script>',
      '<script src="&#x68;ttps&#58;//example.invalid/module.js"></script>',
      '<script src="/src/main.tsx"></script>',
      '<script type="module" src="/@fs/'+host+'/node_modules/recharts/es6/index.js"></script>',
      '<script type="importmap">{"imports":{"react":"https://example.invalid/module.js"}}</script>',
      '<script type="&#105;mportmap">{}</script>',
      '<base href="https://example.invalid/">',
    ]) {
      await writeFile(path.join(root,'index.html'),extra+'<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
      const runtime=new BrowserRuntime(root,host);
      try { await expect(runtime.build()).rejects.toThrow(); } finally { await runtime.close(); }
    }
  });
});
