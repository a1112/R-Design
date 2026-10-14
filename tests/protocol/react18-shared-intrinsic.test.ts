import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { projectPackage } from '../../packages/project-workspace/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const shared = `export function SharedButton({refValue,children,...props}){return <button {...props} ref={refValue}>{children}</button>}`;
const registry = `import{extend}from'@react-three/fiber';import{Mesh}from'three';const name='But'+'ton';extend({[name]:class extends Mesh{}});`;
const scene = `import React,{useCallback}from'react';import './Registry';import{SharedButton}from'./SharedButton';
export function Scene({red}){const capture=useCallback(value=>{window.__MESH_REF__=value;(window.__REF_EVENTS__??=[]).push(Boolean(value));},[]);
return <SharedButton refValue={capture}><boxGeometry args={[1.5,1.5,1]}/><meshBasicMaterial color={red?'#dd2211':'#1144dd'} toneMapped={false}/></SharedButton>}`;
const main = `import React,{useRef,useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Canvas}from'@react-three/fiber';import{installRuntime}from'@rdesign/runtime-web';import{SharedButton}from'./SharedButton';import{Scene}from'./Scene';
class Boundary extends React.Component{state={failed:false};static getDerivedStateFromError(){return{failed:true}};componentDidCatch(error){window.__SCENE_ERROR__=error.message};render(){return this.state.failed?null:this.props.children}}
function App(){const[count,setCount]=useState(0),control=useRef(null);useEffect(()=>{window.__DOM_REF__=control.current;window.__DOM_REF_OBJECT__=control;});return <main data-rdesign-ready="true"><h1>Shared DOM/Fiber component</h1><SharedButton refValue={control} onClick={()=>setCount(value=>value+1)}>Count {count}</SharedButton>
<section style={{width:'100%',height:280}}><Canvas dpr={1} camera={{position:[0,0,5]}} gl={{preserveDrawingBuffer:true,antialias:false}} onCreated={({gl})=>{window.__PROFILE_GL__=gl;}}><Boundary><Scene red={count>0}/></Boundary></Canvas></section></main>}
const root=createRoot(document.getElementById('root')!);window.__RENDER_ROOT__=root;root.render(<App/>);installRuntime();`;

it.each(['live', 'candidate'] as const)('distinguishes actual DOM and Fiber instances of the same cross-component button in %s', async kind => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-shared-intrinsic-'));
  const runtime = new BrowserRuntime(root, host, kind);
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage({ '@react-three/fiber': '8.18.0', three: '0.183.2' }, 'react18')));
    await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    for (const [file, content] of Object.entries({ 'main.tsx': main, 'Scene.tsx': scene, 'SharedButton.tsx': shared, 'Registry.ts': registry })) await writeFile(path.join(root, 'src', file), content);
    await runtime.build(); await runtime.start();
    await runtime.page.waitForFunction(() => Boolean((window as any).__SCENE_ERROR__) || (window as any).__MESH_REF__?.isMesh);
    expect(await runtime.page.evaluate(() => (window as any).__SCENE_ERROR__)).toBeUndefined();
    const color = (red: boolean) => runtime.page.waitForFunction(red => {
      const gl = (window as any).__PROFILE_GL__?.getContext(); if (!gl) return false;
      const pixel = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return gl instanceof WebGL2RenderingContext && (red ? pixel[0] > pixel[2]+100 : pixel[2] > pixel[0]+100);
    }, red);
    await color(false);
    const button = runtime.page.getByRole('button'), id = await button.getAttribute('data-rdesign-id');
    expect(id).toMatch(/^source-/);
    expect((await runtime.capture()).nodes.find(node => node.sourceNodeId === id)?.binding).toMatchObject({ file: 'src/SharedButton.tsx', reliability: 'exact' });
    expect(await runtime.page.evaluate(() => ({ dom: (window as any).__DOM_REF__ instanceof HTMLButtonElement, mesh: (window as any).__MESH_REF__.isMesh, events: (window as any).__REF_EVENTS__, meshHasData: 'data' in (window as any).__MESH_REF__ }))).toEqual({dom:true,mesh:true,events:[true],meshHasData:false});
    await button.click(); await color(true);
    expect(await button.textContent()).toBe('Count 1');
    expect(await runtime.page.evaluate(() => (window as any).__REF_EVENTS__)).toEqual([true]);
    await runtime.page.evaluate(() => (window as any).__RENDER_ROOT__.unmount());
    await runtime.page.waitForFunction(() => (window as any).__REF_EVENTS__?.length === 2 && (window as any).__DOM_REF_OBJECT__?.current === null);
    expect(await runtime.page.evaluate(() => (window as any).__REF_EVENTS__)).toEqual([true, false]);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 90000);
