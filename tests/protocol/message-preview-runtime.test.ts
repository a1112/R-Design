import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { packPreparedEngineeringBundle, type PreparedEngineeringConfig } from '../../packages/project-workspace/src/prepared-engineering';
import { ProjectWorkspace, projectPackage, validatePortableProjectBundle } from '../../packages/project-workspace/src/index';
import { preflightEngineeringBundle } from '../../packages/project-workspace/src/engineering';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { ChangeEngine } from '../../packages/change-engine/src/index';

const host = path.resolve(import.meta.dirname, '../..'), run = promisify(execFile), directories: string[] = [];
const versions = {
  '@reduxjs/toolkit': '2.13.0', 'react-redux': '9.3.0', '@tauri-apps/plugin-notification': '2.5.1',
  'lucide-react-v152': '1.52.0', 'pdfjs-dist-v6': '6.4.299', prismjs: '1.30.0',
  'react-markdown-v10': '10.1.0', 'rehype-sanitize': '6.0.0',
};
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// Original disposable PDF, written as Git-backed fixture bytes; no user document.
function syntheticPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, text] of [[3, 'Local PDF page one'], [5, 'Local PDF page two']] as const) {
    const stream = `BT /F1 20 Tf 35 200 Td (${text}) Tj ET\n`;
    objects[index] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  }
  let result = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return result + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
}

const main = String.raw`import React,{useEffect,useRef} from 'react';import{createRoot}from'react-dom/client';
import{configureStore,createSlice}from'@reduxjs/toolkit';import{Provider,useDispatch,useSelector}from'react-redux';
import Markdown from'react-markdown-v10';import remarkGfm from'remark-gfm';import rehypeSanitize from'rehype-sanitize';import Prism from'prismjs';import'prismjs/components/prism-typescript';import{MessagesSquare}from'lucide-react-v152';
import{isTauri}from'@tauri-apps/api/core';import{onAction}from'@tauri-apps/plugin-notification';
import*as pdfjs from'pdfjs-dist-v6/legacy/build/pdf.mjs';import workerUrl from'pdfjs-dist-v6/legacy/build/pdf.worker.min.mjs?url';
const diagnostics={workers:[],results:null,error:null};const RealWorker=globalThis.Worker;
globalThis.Worker=class extends RealWorker{constructor(url,options){super(url,options);const entry={url:String(url),sent:0,received:0,errors:[]};diagnostics.workers.push(entry);const post=this.postMessage.bind(this);this.postMessage=(...args)=>{entry.sent++;return post(...args)};this.addEventListener('message',()=>entry.received++);this.addEventListener('error',e=>entry.errors.push(e.message))}};
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
const slice=createSlice({name:'synthetic',initialState:{count:0},reducers:{increase(state){state.count++}}});const store=configureStore({reducer:slice.reducer});
const markdown='# Local Markdown\n\n| Kind | Value |\n| --- | --- |\n| Synthetic | 42 |\n\n- [x] Local task\n\n[unsafe](javascript:alert(1))\n\n<script>globalThis.__UNSAFE_MARKDOWN__=true</script>\n\n![local label](https://example.invalid/private-image.png)';
function App(){const canvas=useRef(null),count=useSelector(state=>state.count),dispatch=useDispatch();
useEffect(()=>{let documentNode,cancelled=false;const loading=pdfjs.getDocument({url:new URL('./synthetic-pdf.txt',import.meta.url).href,rangeChunkSize:64*1024});Object.assign(window,{__MESSAGE_PREVIEW_FIXTURE__:{diagnostics,pdfjs,store,native:isTauri(),notificationExport:typeof onAction}});
void loading.promise.then(async doc=>{documentNode=doc;if(cancelled)return;const first=await doc.getPage(1),second=await doc.getPage(2),text1=await first.getTextContent(),text2=await second.getTextContent(),viewport=first.getViewport({scale:0.75});const target=canvas.current;target.width=viewport.width;target.height=viewport.height;await first.render({canvas:target,canvasContext:target.getContext('2d'),viewport}).promise;diagnostics.results={pages:doc.numPages,first:text1.items.map(item=>item.str??'').join(' '),second:text2.items.map(item=>item.str??'').join(' '),canvasWidth:target.width,canvasHeight:target.height};}).catch(error=>{if(!cancelled)diagnostics.error=String(error)});
return()=>{cancelled=true;void(documentNode?documentNode.destroy():loading.destroy())}},[]);
return <main style={{padding:16}}><style>{'.token.keyword{color:rgb(116,40,155)}'}</style><h1 data-rdesign-id="message-preview-title">Synthetic message previews</h1><MessagesSquare data-testid="separate-icon"/><button data-testid="count" onClick={()=>dispatch(slice.actions.increase())}>Count {count}</button><p data-testid="native-state">Native unavailable</p>
<article data-testid="markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{img:({alt})=><span data-testid="blocked-image">Remote image blocked: {alt}</span>}}>{markdown}</Markdown></article>
<pre data-testid="prism" dangerouslySetInnerHTML={{__html:Prism.highlight('const local: number = 42;',Prism.languages.typescript,'typescript')}}/><canvas ref={canvas} aria-label="Synthetic PDF page"/></main>}
createRoot(document.getElementById('root')).render(<Provider store={store}><App/></Provider>);`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-message-preview-')); directories.push(root);
  const upstream = path.join(root, 'upstream'), prepared = path.join(root, 'prepared'), pdf = syntheticPdf();
  await mkdir(path.join(upstream, 'web/src'), { recursive: true }); await mkdir(path.join(prepared, 'src'), { recursive: true });
  await writeFile(path.join(upstream, 'web/src/main.tsx'), main); await writeFile(path.join(upstream, 'web/src/synthetic-pdf.txt'), pdf);
  await writeFile(path.join(upstream, 'web/package.json'), JSON.stringify({ dependencies: { react: '19.3.0', 'react-dom': '19.3.0', ...versions, 'remark-gfm': '4.0.1', '@tauri-apps/api': '2.8.0' } }));
  await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
  await run('git', ['-C', upstream, '-c', 'user.name=Preview Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic preview fixture']);
  const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
  const adapted = "import{installRuntime}from'@rdesign/runtime-web';\n" + main + '\ninstallRuntime();';
  const ledger = { schemaVersion: 1, source: { repository: 'example/message-preview', commit }, stagedFiles: [{ sourcePath: 'web/src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(main), sha256: digest(adapted) }, { sourcePath: 'web/src/synthetic-pdf.txt', path: 'src/synthetic-pdf.txt', sourceSha256: digest(pdf), sha256: digest(pdf) }], splitResources: [] };
  for (const [file, content] of Object.entries({ 'src/main.tsx': adapted, 'src/synthetic-pdf.txt': pdf, 'src/preview-origin.json': JSON.stringify(ledger), 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'package.json': JSON.stringify(projectPackage({ ...versions, 'remark-gfm': '4.0.1', '@tauri-apps/api': '2.8.0' })) })) await writeFile(path.join(prepared, file), content);
  const config: PreparedEngineeringConfig = { repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/message-preview', commit, name: 'Synthetic message preview', preparedDirectory: prepared, provenanceFile: 'src/preview-origin.json', limitations: ['Disposable PDF/Markdown/Redux browser fixture; no user source, transport, native notification or backend success'], scenarios: [{ id: 'preview-main', name: 'Preview', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="message-preview-title"]', steps: [], dependencies: ['src/main.tsx', 'src/synthetic-pdf.txt'], status: 'unverified' }] };
  return { root, config };
}

async function assertPreview(runtime: BrowserRuntime) {
  const page = runtime.page;
  await page.waitForFunction(() => Boolean((window as any).__MESSAGE_PREVIEW_FIXTURE__?.diagnostics.results || (window as any).__MESSAGE_PREVIEW_FIXTURE__?.diagnostics.error));
  const state = await page.evaluate(() => {
    const fixture = (window as any).__MESSAGE_PREVIEW_FIXTURE__, canvas = document.querySelector('canvas')!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3] > 0) darkPixels++;
    return { diagnostics: fixture.diagnostics, native: fixture.native, notificationExport: fixture.notificationExport, version: fixture.pdfjs.version, darkPixels, unsafe: (window as any).__UNSAFE_MARKDOWN__ };
  });
  expect(state.diagnostics.error).toBeNull(); expect(state.version).toBe('6.4.299');
  expect(state.diagnostics.results).toMatchObject({ pages: 2, first: 'Local PDF page one', second: 'Local PDF page two', canvasWidth: 300, canvasHeight: 225 });
  expect(state.darkPixels).toBeGreaterThan(100);
  expect(state.diagnostics.workers.some((worker: any) => worker.url.includes('pdf.worker') && worker.sent > 0 && worker.received > 0)).toBe(true);
  expect(state.diagnostics.workers.every((worker: any) => worker.errors.length === 0)).toBe(true);
  expect(state.native).toBe(false); expect(state.notificationExport).toBe('function'); expect(state.unsafe).toBeUndefined();
  expect(await page.getByTestId('markdown').locator('table tbody td').allTextContents()).toEqual(['Synthetic', '42']);
  expect(await page.getByTestId('markdown').locator('a').filter({ hasText: 'unsafe' }).getAttribute('href')).toBeNull();
  expect(await page.getByTestId('markdown').locator('img,script').count()).toBe(0);
  expect(await page.getByTestId('blocked-image').textContent()).toContain('Remote image blocked');
  const keyword = page.getByTestId('prism').locator('.token.keyword').first(); expect(await keyword.textContent()).toBe('const');
  expect(await keyword.evaluate(element => getComputedStyle(element).color)).toBe('rgb(116, 40, 155)');
  await page.getByTestId('count').click(); expect(await page.getByTestId('count').textContent()).toBe('Count 1');
  expect(await page.getByTestId('separate-icon').count()).toBe(1);
  const range = await page.request.get(runtime.url() + '/src/synthetic-pdf.txt', { headers: { Range: 'bytes=0-63' } });
  expect(range.status()).toBe(206); expect((await range.body()).byteLength).toBe(64); expect(range.headers()['content-range']).toMatch(/^bytes 0-63\//);
}

describe('pinned message preview browser runtime', () => {
  it('accepts separate exact profiles and rejects ranges/install aliases', () => {
    expect(projectPackage(versions).dependencies).toMatchObject(versions);
    for (const [name, version] of Object.entries(versions)) for (const invalid of ['0.0.0', '^' + version, '~' + version, 'npm:' + name + '@' + version]) expect(() => projectPackage({ [name]: invalid })).toThrow();
  });
  it('rejects resigned portable packages with changed profile versions', async () => {
    const { config } = await fixture(), valid = await packPreparedEngineeringBundle(config);
    for (const [name, version] of Object.entries(versions)) {
      const malformed = structuredClone(valid), item = malformed.sourceFiles.find(file => file.path === 'package.json')!;
      const parsed = JSON.parse(item.content); parsed.dependencies[name] = '^' + version; item.content = JSON.stringify(parsed); item.sha256 = digest(item.content);
      const { checksum: _, ...payload } = malformed; malformed.checksum = digest(JSON.stringify(payload));
      expect(() => validatePortableProjectBundle(malformed)).toThrow();
    }
  });
  it('imports/builds and executes real PDF6 worker, Markdown sanitation, Prism, Redux and a candidate through apply/revert', async () => {
    const { root, config } = await fixture(), bundle = await packPreparedEngineeringBundle(config);
    validatePortableProjectBundle(bundle); expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const data = path.join(root, 'catalog'), linked = path.join(host, 'fixtures/react-monitor');
    const seed = await new DocumentStore(data).load(await codeHash(linked)), catalog = await new ProjectWorkspace(data, linked, host).load(seed.project);
    const first = await catalog.import(bundle), second = await catalog.import(bundle); expect(first.id).not.toBe(second.id);
    const source = await catalog.validate(first.id); await expect(readFile(path.join(source.sourceDirectory, 'node_modules/package.json'))).rejects.toThrow();
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory)), runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start(); const errors: string[] = []; runtime.page.on('pageerror', error => errors.push(error.message));
      await assertPreview(runtime);
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'message-preview-title')!; expect(target.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, host), candidate = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Synthetic preview title', properties: { text: 'Preview profile checked' }, scope: 'instance' });
      await engine.verify(candidate.id); expect(candidate.status, JSON.stringify(candidate.evidence)).toBe('verified'); expect(candidate.evidence.every(item => item.passed)).toBe(true);
      const candidateRuntime = new BrowserRuntime(engine.candidateRoot(candidate.id), host, 'candidate', 0, source.dataDirectory);
      try { await candidateRuntime.start(); await assertPreview(candidateRuntime); } finally { await candidateRuntime.close(); }
      await engine.apply(candidate.id, candidate.diffHash); await runtime.capture(); expect(await runtime.page.locator('h1').first().textContent()).toBe('Preview profile checked'); await assertPreview(runtime);
      await engine.revert(candidate.id); await runtime.capture(); expect(await runtime.page.locator('h1').first().textContent()).toBe('Synthetic message previews'); await assertPreview(runtime); expect(errors).toEqual([]);
    } finally { await runtime.close(); }
  }, 240000);
});
