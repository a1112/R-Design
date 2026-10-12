import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { projectPackage } from '../../packages/project-workspace/src/index';

const host = path.resolve(import.meta.dirname, '../..');
const main = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Canvas}from'@react-three/fiber';import{OrbitControls}from'@react-three/drei';import{installRuntime}from'@rdesign/runtime-web';
function App(){const[red,setRed]=useState(false);const[hover,setHover]=useState(0);return <main data-rdesign-ready="true">
  <h1 data-rdesign-id="scene-title">Synthetic React 18 scene</h1><output>{React.version}</output>
  <button data-rdesign-id="scene-toggle" onClick={()=>setRed(value=>!value)}>Change color</button><span>Hover {hover}</span>
  <section style={{height:280,width:'100%'}}><Canvas dpr={1} camera={{position:[0,0,5]}} gl={{preserveDrawingBuffer:true,antialias:false}}
    onCreated={({gl,scene})=>{window.__PROFILE_GL__={gl,scene};}}>
    <mesh rotation={[Math.PI/2,0,0]} onPointerOver={()=>setHover(value=>value+1)}><cylinderGeometry args={[1,1,1,16]}/><meshBasicMaterial color={red?'#dd2211':'#1144dd'} toneMapped={false}/></mesh>
    <OrbitControls enableRotate={false} enablePan={false} enableZoom={false}/>
  </Canvas></section></main>}
createRoot(document.getElementById('root')!).render(<App/>);installRuntime();`;

it.each(['live', 'candidate'] as const)('renders and interacts with actual fiber8/drei9 WebGL2 in the %s React 18 runtime', async kind => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-react18-webgl-'));
  const runtime = new BrowserRuntime(root, host, kind);
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(projectPackage({ '@react-three/fiber': '8.18.0', '@react-three/drei': '9.122.0', three: '0.183.2' }, 'react18')));
    await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(root, 'src/main.tsx'), main);
    await runtime.build(); await runtime.start();
    const color = async (red: boolean) => {
      await runtime.page.waitForFunction(red => {
        const renderer = (window as any).__PROFILE_GL__?.gl;
        if (!renderer) return false;
        const gl = renderer.getContext(); const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth/2), Math.floor(gl.drawingBufferHeight/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return red ? pixel[0] > pixel[2] + 100 : pixel[2] > pixel[0] + 100;
      }, red);
    };
    await color(false);
    expect(await runtime.page.locator('output').textContent()).toBe('18.3.1');
    const capability = await runtime.page.evaluate(() => {
      const { gl: renderer, scene } = (window as any).__PROFILE_GL__;
      const gl = renderer.getContext(); const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: gl instanceof WebGL2RenderingContext, version: gl.getParameter(gl.VERSION),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        meshes: scene.children.filter((item: any) => item.isMesh).length, error: gl.getError() };
    });
    expect(capability).toMatchObject({ webgl2: true, meshes: 1, error: 0 });
    console.log(JSON.stringify({ kind, ...capability }));
    await runtime.page.locator('canvas').hover();
    await expect.poll(() => runtime.page.locator('span').textContent()).toBe('Hover 1');
    const before = await runtime.capture();
    expect(before.nodes.find(node => node.sourceNodeId === 'scene-title')?.binding?.reliability).toBe('exact');
    await runtime.page.getByRole('button').click(); await color(true);
    expect((await runtime.capture()).image).not.toBe(before.image);
    await runtime.viewport(390, 844); await color(true);
    expect(await runtime.page.locator('canvas').evaluate(canvas => canvas.clientWidth)).toBeLessThanOrEqual(390);
    await runtime.page.reload(); await color(false);
    expect(await runtime.page.locator('output').textContent()).toBe('18.3.1');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 90000);
