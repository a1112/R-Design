import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { PDF5_RESOURCE_PREFIX } from '../../apps/bridge/src/pdf5-resources';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { ProjectWorkspace, projectPackage } from '../../packages/project-workspace/src/index';
import { packPreparedEngineeringBundle } from '../../packages/project-workspace/src/prepared-engineering';

const host = path.resolve(import.meta.dirname, '../..'), roots: string[] = [], run = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function imagePdf() {
  // Original synthetic 8x8 red/blue image, losslessly encoded by OpenJPEG2.5.4.
  const jpx = Buffer.from('AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAACAAAAAgAAwcHAAAAAAAPY29scgEAAAAAABAAAADeanAyY/9P/1EALwAAAAAACAAAAAgAAAAAAAAAAAAAAAgAAAAIAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAQAEBAAB/1wABEBA/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAZgAB/5PH1CoRUFMe/1TqXTwAAGEhGqFDCPaVAj/fgLg7uQ7Hjf1FK2hkv3gAAYSEs3cgAYSEv9+BGBQAWx8gQM5BG84AwjzFCAYR5inEhIlnAGEeYpxISJZwBhIS/9k=', 'base64');
  // Synthetic 8x8 black CCITT Group4 image exercises the jbig2 JS module's fax decoder.
  const fax = Buffer.from('26a2fffe002002', 'hex');
  const stream = (dictionary: string, bytes: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 32] /Resources << /XObject << /Jpx 5 0 R /Fax 6 0 R >> >> /Contents 4 0 R >>'),
    stream('', Buffer.from('q 32 0 0 32 0 0 cm /Jpx Do Q\nq 32 0 0 32 32 0 cm /Fax Do Q\n')),
    stream('/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode', jpx),
    stream('/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 8 /Rows 8 /BlackIs1 false >>', fax)];
  const chunks = [Buffer.from('%PDF-1.5\n')], offsets = [0]; let length = chunks[0].length;
  objects.forEach((object, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

const source = String.raw`import React,{useEffect,useRef}from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';import*as pdfjs from'pdfjs-dist-v5/build/pdf.min.mjs';import workerUrl from'pdfjs-dist-v5/build/pdf.worker.min.mjs?url';import chunk from'./pdf.part.json';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;window.__PDF_FALLBACK__={useWasm:false,error:null,pixels:null};
function App(){const canvas=useRef(null),ready=useRef(null);useEffect(()=>{const data=Uint8Array.from(atob(chunk.base64),c=>c.charCodeAt(0)),prefix=new URL('/__rdesign_resources/pdfjs-v5/',location.origin).href;
const loading=pdfjs.getDocument({data,useWasm:false,isEvalSupported:false,stopAtErrors:true,cMapUrl:prefix+'cmaps/',cMapPacked:true,standardFontDataUrl:prefix+'standard_fonts/',wasmUrl:prefix+'wasm/'});
void loading.promise.then(async pdf=>{const page=await pdf.getPage(1),viewport=page.getViewport({scale:1}),node=canvas.current;node.width=viewport.width;node.height=viewport.height;await page.render({canvas:node,canvasContext:node.getContext('2d'),viewport}).promise;const values=node.getContext('2d').getImageData(0,0,node.width,node.height).data;let red=0,blue=0,black=0;for(let i=0;i<values.length;i+=4){if(values[i]>150&&values[i+1]<60&&values[i+2]<60)red++;if(values[i]<60&&values[i+1]<120&&values[i+2]>150)blue++;if(values[i]<30&&values[i+1]<30&&values[i+2]<30)black++;}window.__PDF_FALLBACK__.pixels={red,blue,black,width:node.width,height:node.height};if(red<400||blue<400||black<900)throw Error('Synthetic image pixels did not decode');ready.current.dataset.ready='yes';ready.current.textContent='JPEG2000 and CCITT decoded with WASM disabled';}).catch(error=>window.__PDF_FALLBACK__.error=String(error));return()=>{void loading.destroy()}},[]);
return <main><h1 data-rdesign-id="fallback-title">Synthetic image fallback</h1><p>Committed synthetic images; no native/cloud/OCR/automatic streaming</p><div ref={ready} data-rdesign-id="fallback-ready"/><canvas ref={canvas}/></main>};createRoot(document.getElementById('root')).render(<App/>);installRuntime();`;

it('serves strict JS MIME and actually decodes JPEG2000/CCITT without WASM in live and candidate imports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-pdf5-fallback-')); roots.push(root);
  const upstream = path.join(root, 'upstream'), prepared = path.join(root, 'prepared'), pdfPath = 'fixtures/r-md-workspace/09-pdf/sample-report.pdf', bytes = imagePdf();
  await mkdir(path.dirname(path.join(upstream, pdfPath)), { recursive: true }); await mkdir(path.join(upstream, 'src'));
  await writeFile(path.join(upstream, pdfPath), bytes); await writeFile(path.join(upstream, 'src/main.tsx'), source);
  await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']); await run('git', ['-C', upstream, '-c', 'user.name=PDF Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic fallback images']);
  const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
  const ledger = { schemaVersion: 1, source: { repository: 'example/pdf5-fallback', commit }, stagedFiles: [{ sourcePath: 'src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(source), sha256: digest(source) }], splitResources: [{ file: pdfPath, bytes: bytes.length, sha256: digest(bytes), sourceRole: 'reader-pdf-fixture', chunks: ['src/pdf.part.json'] }] };
  for (const [file, content] of Object.entries({ 'src/main.tsx': source, 'src/pdf.part.json': JSON.stringify({ base64: bytes.toString('base64') }), 'src/origin.json': JSON.stringify(ledger), 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'package.json': JSON.stringify(projectPackage({ mermaid: '11.17.2', 'pdfjs-dist-v5': '5.7.284', 'highlight-js-v1112': '11.12.0', '@tauri-apps/api': '2.8.0' })) })) { await mkdir(path.dirname(path.join(prepared, file)), { recursive: true }); await writeFile(path.join(prepared, file), content); }
  const bundle = await packPreparedEngineeringBundle({ repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/pdf5-fallback', commit, preparedDirectory: prepared, provenanceFile: 'src/origin.json', name: 'Synthetic PDF fallback', readerPdfFixtures: [{ sourcePath: pdfPath, sourceSha256: digest(bytes) }], limitations: ['Synthetic JPEG2000/CCITT decoding only; no actual JBIG2 image, OCR or streaming acceptance'], scenarios: [{ id: 'fallback', name: 'Fallback', route: '/', viewport: { width: 1200, height: 900 }, steps: [], readySelector: '[data-rdesign-id="fallback-ready"][data-ready="yes"]', dependencies: ['src/main.tsx'], status: 'unverified' }] });
  const data = path.join(root, 'catalog'), legacy = path.join(host, 'fixtures/react-monitor'), seed = await new DocumentStore(data).load(await codeHash(legacy)), catalog = await new ProjectWorkspace(data, legacy, host).load(seed.project);
  for (const kind of ['live', 'candidate'] as const) {
    const imported = await catalog.import(bundle), entry = await catalog.validate(imported.id); expect(await readdir(entry.sourceDirectory)).not.toContain('node_modules');
    const runtime = new BrowserRuntime(entry.sourceDirectory, host, kind, 0, entry.dataDirectory);
    try {
      await runtime.build(); await runtime.start(); const requested: string[] = [], errors: string[] = [];
      runtime.page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith(PDF5_RESOURCE_PREFIX)) requested.push(url.pathname); }); runtime.page.on('pageerror', error => errors.push(error.message));
      await runtime.page.reload({ waitUntil: 'networkidle' });
      await runtime.page.waitForFunction(() => { const state = (window as any).__PDF_FALLBACK__; return state?.error || state?.pixels; });
      const result = await runtime.page.evaluate(() => (window as any).__PDF_FALLBACK__);
      expect(result.error).toBeNull(); expect(result.useWasm).toBe(false); expect(result.pixels).toMatchObject({ width: 64, height: 32 }); expect(result.pixels.red).toBeGreaterThan(400); expect(result.pixels.blue).toBeGreaterThan(400); expect(result.pixels.black).toBeGreaterThan(900);
      expect(requested).toContain(PDF5_RESOURCE_PREFIX + 'wasm/openjpeg_nowasm_fallback.js'); expect(requested).toContain(PDF5_RESOURCE_PREFIX + 'wasm/jbig2_nowasm_fallback.js'); expect(requested.some(value => value.endsWith('.wasm'))).toBe(false); expect(errors).toEqual([]);
      for (const name of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'quickjs-eval.js']) for (const method of ['GET', 'HEAD']) { const response = await runtime.page.request.fetch(runtime.url() + PDF5_RESOURCE_PREFIX + 'wasm/' + name, { method }); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toBe('text/javascript'); expect(response.headers()['x-content-type-options']).toBe('nosniff'); if (method === 'GET') expect(digest(await response.body())).toBe(digest(await readFile(path.join(host, 'node_modules/pdfjs-dist-v5/wasm', name)))); }
      for (const [folder, name, mime] of [['wasm', 'openjpeg.wasm', 'application/wasm'], ['cmaps', 'UniGB-UCS2-H.bcmap', 'application/octet-stream'], ['standard_fonts', 'LiberationSans-Regular.ttf', 'application/octet-stream']]) { const response = await runtime.page.request.get(runtime.url() + PDF5_RESOURCE_PREFIX + folder + '/' + name); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toBe(mime); expect(digest(await response.body())).toBe(digest(await readFile(path.join(host, 'node_modules/pdfjs-dist-v5', folder, name)))); }
      const frame = await runtime.capture(); expect(frame.kind).toBe(kind); expect(frame.nodes.find(node => node.sourceNodeId === 'fallback-ready')?.text).toContain('JPEG2000 and CCITT decoded');
    } finally { await runtime.close(); }
  }
}, 180000);
