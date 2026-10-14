import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from '@babel/parser';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { profileHostDependencies } from '../../apps/bridge/src/runtime-dependencies';
import { projectPackage } from '../../packages/project-workspace/src/index';
import { injectSourceIds } from '../../packages/runtime-web/src/vite';

const host = path.resolve(import.meta.dirname, '../..');
it('defers DOM-only IDs to mounted instances across toolbar, scene and Html portal elements', () => {
  const code = `import{Canvas as Surface}from'@react-three/fiber';import{Html as Portal}from'@react-three/drei';
  const App=()=> <main><button>Toolbar</button><Surface><button/><customSceneObject/><Portal><button>Portal toolbar</button></Portal></Surface></main>;`;
  const transformed = injectSourceIds(code, '/fixture/src/main.tsx', '/fixture', new Set(), true);
  const ast = parse(transformed, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const openings: Array<{name:string;id:boolean}> = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier') openings.push({ name: node.name.name, id: node.attributes.some((item: any) => item.name?.name === 'data-rdesign-id') });
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); }
  };
  visit(ast.program);
  expect(openings.filter(item => item.name === 'button').map(item => item.id)).toEqual([false, false, false]);
  expect(openings.find(item => item.name === 'customSceneObject')?.id).toBe(false);
  expect(transformed).toContain('setAttribute');
  // The legacy/default transform retains its existing custom-element behavior.
  expect(injectSourceIds('<customSceneObject/>', '/fixture/src/main.tsx', '/fixture')).toContain('data-rdesign-id');
});
const scene = `import{extend}from'@react-three/fiber';import{Mesh,CylinderGeometry}from'three';
class ProfileMesh extends Mesh{};class ProfileCylinder extends CylinderGeometry{};extend({ProfileMesh,ProfileCylinder});
export function Scene({red}){return <profileMesh rotation={[Math.PI/2,0,0]}><profileCylinder args={[1,1,1,16]}/><meshBasicMaterial color={red?'#dd2211':'#1144dd'} toneMapped={false}/></profileMesh>}`;
const main = `import React,{type ReactNode,useState}from'react';import{createRoot}from'react-dom/client';
import type{Shape}from'profile-type-syntax';import{type Shape as InlineShape}from'profile-type-syntax';
import{Canvas}from'@react-three/fiber';import{Scene}from'./Scene';import{installRuntime}from'@rdesign/runtime-web';
const typed:Shape={label:'typed'},inline:InlineShape=typed;
function App(){const[count,setCount]=useState(0);return <main data-rdesign-ready="true"><h1>Custom intrinsic</h1><button onClick={()=>setCount(value=>value+1)}>Count {count}</button>
<span>{inline.label}</span>
<section style={{width:'100%',height:280}}><Canvas dpr={1} camera={{position:[0,0,5]}} gl={{preserveDrawingBuffer:true,antialias:false}} onCreated={({gl})=>{window.__PROFILE_GL__=gl;}}><Scene red={count>0}/></Canvas></section></main>}
createRoot(document.getElementById('root')!).render(<App/>);installRuntime();`;

async function files(root: string, content: string, renderer = false, profile: 'react18' | 'react19' = 'react18') {
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage(renderer ? { '@react-three/fiber': '8.18.0', three: '0.183.2' } : {}, profile)));
  await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await writeFile(path.join(root, 'src/main.tsx'), content);
}

it.each([
  ['react18', 'import type { Shape }'], ['react18', 'import { type Shape }'],
  ['react19', 'import type { Shape }'], ['react19', 'import { type Shape }'],
] as const)('compiles %s pure syntax %s without a runtime type-module import', async (profile, declaration) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-pure-type-syntax-'));
  const runtime = new BrowserRuntime(root, host);
  try {
    await files(root, `${declaration} from 'profile-type-syntax';const value:Shape={label:'typed'};document.getElementById('root')!.textContent=value.label;`, false, profile);
    await writeFile(path.join(root, 'src/types.d.ts'), "declare module 'profile-type-syntax' { export interface Shape { label:string } }");
    await runtime.build();
    const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
    const entry = html.match(/src="([^"]+\.js)"/)![1];
    const compiled = await readFile(path.join(root, 'dist', entry.replace(/^\//, '')), 'utf8');
    expect(compiled).toContain('typed');
    expect(compiled).not.toContain('profile-type-syntax');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

it('retains the default React 19 browser hooks and DOM source mapping', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-default-renderer-'));
  const runtime = new BrowserRuntime(root, host);
  try {
    await files(root, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';
function App(){const[count,setCount]=useState(0);return <main><output>{React.version}</output><button onClick={()=>setCount(value=>value+1)}>Count {count}</button></main>}
createRoot(document.getElementById('root')!).render(<App/>);installRuntime();`, false, 'react19');
    await runtime.build(); await runtime.start();
    expect(await runtime.page.locator('output').textContent()).toMatch(/^19\./);
    const button = runtime.page.getByRole('button'), id = await button.getAttribute('data-rdesign-id');
    expect((await runtime.capture()).nodes.find(node => node.sourceNodeId === id)?.binding?.reliability).toBe('exact');
    await button.click(); expect(await button.textContent()).toBe('Count 1');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

it.each(['live', 'candidate'] as const)('mounts extended Three intrinsics and preserves ordinary DOM source binding in %s', async kind => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-extended-intrinsic-'));
  const runtime = new BrowserRuntime(root, host, kind);
  try {
    await files(root, main, true); await writeFile(path.join(root, 'src/Scene.tsx'), scene);
    await writeFile(path.join(root, 'src/types.d.ts'), "declare module 'profile-type-syntax' { export interface Shape { label:string } }");
    await runtime.build(); await runtime.start();
    const color = async (red: boolean) => runtime.page.waitForFunction(red => {
      const renderer = (window as any).__PROFILE_GL__; if (!renderer) return false;
      const gl = renderer.getContext(); const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth/2), Math.floor(gl.drawingBufferHeight/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return gl instanceof WebGL2RenderingContext && (red ? pixel[0] > pixel[2]+100 : pixel[2] > pixel[0]+100);
    }, red);
    await color(false);
    expect(await runtime.page.locator('span').textContent()).toBe('typed');
    const button = runtime.page.getByRole('button'), id = await button.getAttribute('data-rdesign-id');
    expect(id).toMatch(/^source-/);
    expect((await runtime.capture()).nodes.find(node => node.sourceNodeId === id)?.binding).toMatchObject({ file: 'src/main.tsx', reliability: 'exact' });
    await button.click(); await color(true); expect(await button.textContent()).toBe('Count 1');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 90000);
