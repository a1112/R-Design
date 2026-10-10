import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { BrowserRuntime } from '../../apps/bridge/src/runtime';
import { PDF5_RESOURCE_PREFIX } from '../../apps/bridge/src/pdf5-resources';
import { ChangeEngine } from '../../packages/change-engine/src/index';
import { DocumentStore, digest } from '../../packages/document-core/src/index';
import { codeHash } from '../../packages/source-binding/src/index';
import { ProjectWorkspace, projectPackage, assertPortableBinaryResource } from '../../packages/project-workspace/src/index';
import { packPreparedEngineeringBundle, type PreparedEngineeringConfig } from '../../packages/project-workspace/src/prepared-engineering';
import { READER_MARKDOWN_SOURCE, READER_MARKDOWN_PREPARED, proveReaderMarkdownFixture } from '../../packages/project-workspace/src/reader-fixture-proof';

const host = path.resolve(import.meta.dirname, '../..'), roots: string[] = [], run = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const versions = { '@tauri-apps/plugin-dialog': '2.8.1', cmdk: '1.1.1', 'dompurify-v3416': '3.4.16', 'github-slugger': '2.0.0',
  'highlight-js-v1112': '11.12.0', katex: '0.16.47', mermaid: '11.17.2', 'pdfjs-dist-v5': '5.7.284',
  'rehype-katex': '7.0.1', 'rehype-raw': '7.0.0', 'rehype-slug': '6.0.0', 'rehype-stringify': '10.0.1',
  'remark-math': '6.0.0', 'remark-parse': '11.0.0', 'remark-rehype': '11.1.2', unified: '11.0.5', yjs: '13.6.32', 'zod-v4': '4.6.5' };
const shortWords = '# Short Tokens\n\n合成短词样本，用于本地阅读测试。\n\n- UI\n- DB\n- CJK\n';
const pdfPath = 'fixtures/r-md-workspace/09-pdf/sample-report.pdf';
function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, label] of [[3, 'Synthetic reader page one'], [5, 'Synthetic reader page two']] as const) {
    const stream = `BT /F1 20 Tf 35 200 Td (${label}) Tj ET\n`; objects[index] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  }
  let value = '%PDF-1.4\n', offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(value); value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(value + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const worker = String.raw`import{unified}from'unified';import parse from'remark-parse';import gfm from'remark-gfm';import math from'remark-math';import rehype from'remark-rehype';import raw from'rehype-raw';import sanitize,{defaultSchema}from'rehype-sanitize';import katex from'rehype-katex';import slug from'rehype-slug';import stringify from'rehype-stringify';import GithubSlugger from'github-slugger';import hljs from'highlight-js-v1112/lib/core';import ruby from'highlight-js-v1112/lib/languages/ruby';import perl from'highlight-js-v1112/lib/languages/perl.js';hljs.registerLanguage('ruby',ruby);hljs.registerLanguage('perl',perl);
self.onmessage=async({data})=>{try{const html=String(await unified().use(parse).use(gfm).use(math).use(rehype,{allowDangerousHtml:true}).use(raw).use(sanitize,{...defaultSchema,attributes:{...defaultSchema.attributes,code:[['className','language-math','math-inline','math-display']]}}).use(katex).use(slug).use(stringify).process(data));self.postMessage({html,slug:new GithubSlugger().slug('Local CJK 中文'),ruby:hljs.highlight('class LocalReader\nend',{language:'ruby'}).value,perl:hljs.highlight('sub local_reader { return 42; }',{language:'perl'}).value})}catch(error){self.postMessage({error:String(error)})}};`;
const main = String.raw`import React,{useEffect,useRef}from'react';import{createRoot}from'react-dom/client';import{installRuntime}from'@rdesign/runtime-web';import Purify from'dompurify-v3416';import hljs from'highlight-js-v1112/lib/core';import javascript from'highlight-js-v1112/lib/languages/javascript';import ruby from'highlight-js-v1112/lib/languages/ruby';import perl from'highlight-js-v1112/lib/languages/perl.js';import mermaid from'mermaid';import*as pdfjs from'pdfjs-dist-v5/build/pdf.min.mjs';import workerUrl from'pdfjs-dist-v5/build/pdf.worker.min.mjs?url';import'katex/dist/katex.min.css';import{z}from'zod-v4';import*as Y from'yjs';import{isTauri}from'@tauri-apps/api/core';import{open}from'@tauri-apps/plugin-dialog';import shortWords from'./fixtures/r-md-workspace/06-cjk/short-uiTokens.md?raw';import chunk from'./reader-pdf.part.json';
const fixture={workers:[],pdf:null,markdown:null,error:null,native:isTauri(),dialog:typeof open,purify:Purify.version,highlight:hljs.versionString,zod4:typeof z.toJSONSchema==='function'};
window.__READER_FIXTURE__=fixture;const RealWorker=Worker;window.Worker=class extends RealWorker{constructor(url,opts){super(url,opts);const item={url:String(url),sent:0,received:0,errors:[]};fixture.workers.push(item);const send=this.postMessage.bind(this);this.postMessage=(...args)=>{item.sent++;return send(...args)};this.addEventListener('message',()=>item.received++);this.addEventListener('error',event=>{item.errors.push(event.message);fixture.error=event.message})}};
hljs.registerLanguage('javascript',javascript);hljs.registerLanguage('ruby',ruby);hljs.registerLanguage('perl',perl);const localDoc=new Y.Doc();localDoc.getText('body').insert(0,'Local CRDT');fixture.localCrdt=localDoc.getText('body').toString();pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
const markdown='# Local CJK 中文\n\n| Kind | Value |\n| --- | --- |\n| Synthetic | 42 |\n\nMath: $x^2$\\n\\nEntities: &amp; &notin;\n\n[unsafe](javascript:alert(1))\n\n<script>window.__UNSAFE_READER__=true</script>';
function App(){const canvas=useRef(null),article=useRef(null),diagram=useRef(null);useEffect(()=>{let doc,cancelled=false;const mdWorker=new Worker(new URL('./markdown.worker.ts',import.meta.url),{type:'module'});
mdWorker.onmessage=({data})=>{if(cancelled)return;if(data.error){fixture.error=data.error;return}article.current.innerHTML=Purify.sanitize(data.html);document.querySelector('[data-testid=worker-ruby]').innerHTML=Purify.sanitize(data.ruby);document.querySelector('[data-testid=worker-perl]').innerHTML=Purify.sanitize(data.perl);fixture.markdown=data;};mdWorker.postMessage(markdown);
const bytes=Uint8Array.from(atob(chunk.base64),char=>char.charCodeAt(0)),prefix=new URL('/__rdesign_resources/pdfjs-v5/',location.origin).href;
const loading=pdfjs.getDocument({data:bytes,useSystemFonts:false,isEvalSupported:false,cMapUrl:prefix+'cmaps/',cMapPacked:true,standardFontDataUrl:prefix+'standard_fonts/',wasmUrl:prefix+'wasm/'});
void loading.promise.then(async result=>{doc=result;const first=await result.getPage(1),second=await result.getPage(2),text=await second.getTextContent(),viewport=first.getViewport({scale:0.75});if(cancelled)return;const node=canvas.current;node.width=viewport.width;node.height=viewport.height;await first.render({canvas:node,canvasContext:node.getContext('2d'),viewport}).promise;fixture.pdf={version:pdfjs.version,pages:result.numPages,second:text.items.map(item=>item.str??'').join(' ')}}).catch(error=>{if(!cancelled)fixture.error=String(error)});
mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,flowchart:{htmlLabels:false}});void mermaid.render('syntheticReaderDiagram','flowchart LR\nAlpha-->Beta').then(({svg})=>{if(cancelled)return;diagram.current.innerHTML=Purify.sanitize(svg,{USE_PROFILES:{svg:true}});fixture.diagram=true}).catch(error=>{if(!cancelled)fixture.error=String(error)});
return()=>{cancelled=true;mdWorker.terminate();void(doc?doc.destroy():loading.destroy())}},[]);
return <main style={{padding:20}}><h1 data-rdesign-id="reader-title">Synthetic reader</h1><p>Native, disk and cloud unavailable</p><pre data-testid="short-words">{shortWords}</pre><article ref={article} data-testid="markdown"/><div ref={diagram} data-testid="mermaid"/><pre data-testid="code" dangerouslySetInnerHTML={{__html:hljs.highlight('const local = 42;', {language:'javascript'}).value}}/><pre data-testid="ruby" dangerouslySetInnerHTML={{__html:hljs.highlight('class LocalReader\nend',{language:'ruby'}).value}}/><pre data-testid="perl" dangerouslySetInnerHTML={{__html:hljs.highlight('sub local_reader { return 42; }',{language:'perl'}).value}}/><pre data-testid="worker-ruby" data-rdesign-id="worker-ruby-proof"/><pre data-testid="worker-perl" data-rdesign-id="worker-perl-proof"/><canvas ref={canvas}/></main>};createRoot(document.getElementById('root')).render(<App/>);installRuntime();`;

async function fixture(bytes = pdf(), mainSource = main) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-reader-runtime-')); roots.push(root); const upstream = path.join(root, 'upstream'), prepared = path.join(root, 'prepared');
  await mkdir(path.dirname(path.join(upstream, READER_MARKDOWN_SOURCE)), { recursive: true }); await mkdir(path.dirname(path.join(upstream, pdfPath)), { recursive: true });
  await writeFile(path.join(upstream, READER_MARKDOWN_SOURCE), shortWords); await writeFile(path.join(upstream, pdfPath), bytes);
  await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
  await run('git', ['-C', upstream, '-c', 'user.name=Reader Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic reader fixture']);
  const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
  const ledger = { schemaVersion: 1, source: { repository: 'example/reader-fixture', commit }, stagedFiles: [{ sourcePath: READER_MARKDOWN_SOURCE, path: READER_MARKDOWN_PREPARED, sourceRole: 'reader-markdown-fixture', sourceSha256: digest(shortWords), sha256: digest(shortWords) }],
    splitResources: [{ file: pdfPath, bytes: bytes.length, sha256: digest(bytes), sourceRole: 'reader-pdf-fixture', chunks: ['src/reader-pdf.part.json'] }] };
  for (const [file, content] of Object.entries({ [READER_MARKDOWN_PREPARED]: shortWords, 'src/main.tsx': mainSource, 'src/markdown.worker.ts': worker,
    'src/reader-pdf.part.json': JSON.stringify({ base64: bytes.toString('base64') }), 'src/origin.json': JSON.stringify(ledger), 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    'package.json': JSON.stringify(projectPackage({ ...versions, 'rehype-sanitize': '6.0.0', 'remark-gfm': '4.0.1', '@tauri-apps/api': '2.8.0' })) })) {
    await mkdir(path.dirname(path.join(prepared, file)), { recursive: true }); await writeFile(path.join(prepared, file), content);
  }
  const config: PreparedEngineeringConfig = { repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/reader-fixture', commit, preparedDirectory: prepared, provenanceFile: 'src/origin.json', name: 'Synthetic reader fixture',
    readerMarkdownFixture: { sourceSha256: digest(shortWords) }, readerPdfFixtures: [{ sourcePath: pdfPath, sourceSha256: digest(bytes) }], limitations: ['Synthetic committed reader data, no private source/native/disk/cloud/automatic PDF streaming proof'],
    scenarios: [{ id: 'reader', name: 'Reader', route: '/', viewport: { width: 1200, height: 900 }, steps: [], readySelector: 'main:has(canvas[width="300"]):has([data-testid="worker-ruby"] .hljs-keyword):has([data-testid="worker-perl"] .hljs-keyword)', dependencies: ['src/main.tsx', 'src/markdown.worker.ts'], status: 'unverified' }] };
  return { root, upstream, prepared, config, ledger, bytes };
}
async function assertReader(runtime: BrowserRuntime) {
  await runtime.page.waitForFunction(() => { const x = (window as any).__READER_FIXTURE__; return x?.error || x?.pdf && x?.markdown && x?.diagram; });
  const state = await runtime.page.evaluate(() => { const fixture = (window as any).__READER_FIXTURE__, node = document.querySelector('canvas')!;
    const pixels = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data; let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3] > 0) dark++;
    return { ...fixture, dark, unsafe: (window as any).__UNSAFE_READER__ };
  });
  expect(state.error).toBeNull(); expect(state.pdf).toMatchObject({ version: '5.7.284', pages: 2, second: 'Synthetic reader page two' }); expect(state.dark).toBeGreaterThan(100);
  expect(state.native).toBe(false); expect(state.dialog).toBe('function'); expect(state.purify).toBe('3.4.16'); expect(state.highlight).toBe('11.12.0'); expect(state.zod4).toBe(true); expect(state.localCrdt).toBe('Local CRDT');
  expect(state.workers.some((item: any) => item.url.includes('markdown.worker') && item.sent > 0 && item.received > 0)).toBe(true);
  expect(state.workers.some((item: any) => item.url.includes('pdf.worker') && item.sent > 0 && item.received > 0)).toBe(true); expect(state.workers.every((item: any) => !item.errors.length)).toBe(true);
  expect(await runtime.page.getByTestId('markdown').locator('table tbody td').allTextContents()).toEqual(['Synthetic', '42']);
  expect(await runtime.page.getByTestId('markdown').locator('.katex-html').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);
  expect(await runtime.page.getByTestId('markdown').locator('script').count()).toBe(0); expect(await runtime.page.getByTestId('markdown').getByText('unsafe', { exact: true }).getAttribute('href')).toBeNull(); expect(state.unsafe).toBeUndefined(); expect(await runtime.page.getByTestId('markdown').textContent()).toContain('Entities: & ∉');
  expect(await runtime.page.getByTestId('mermaid').locator('svg').textContent()).toContain('Alpha'); expect(await runtime.page.getByTestId('mermaid').locator('script').count()).toBe(0);
  expect(await runtime.page.getByTestId('code').locator('.hljs-keyword').textContent()).toBe('const'); expect(await runtime.page.getByTestId('short-words').textContent()).toBe(shortWords);
  for (const name of ['ruby', 'worker-ruby']) expect(await runtime.page.getByTestId(name).locator('.hljs-keyword').first().textContent()).toBe('class');
  for (const name of ['perl', 'worker-perl']) expect(await runtime.page.getByTestId(name).locator('.hljs-keyword').first().textContent()).toBe('sub');
  for (const [folder, name] of [['cmaps', 'UniGB-UCS2-H.bcmap'], ['standard_fonts', 'LiberationSans-Regular.ttf'], ['wasm', 'openjpeg.wasm']]) {
    const response = await runtime.page.request.get(runtime.url() + PDF5_RESOURCE_PREFIX + folder + '/' + name); expect(response.status()).toBe(200);
    expect(digest(await response.body())).toBe(digest(await readFile(path.join(host, 'node_modules/pdfjs-dist-v5', folder, name))));
    expect(response.headers()['x-content-type-options']).toBe('nosniff'); if (folder === 'wasm') expect(response.headers()['content-type']).toBe('application/wasm');
  }
  for (const name of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'quickjs-eval.js']) for (const method of ['GET', 'HEAD']) {
    const response = await runtime.page.request.fetch(runtime.url() + PDF5_RESOURCE_PREFIX + 'wasm/' + name, { method });
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toBe('text/javascript'); expect(response.headers()['x-content-type-options']).toBe('nosniff');
    if (method === 'GET') expect(digest(await response.body())).toBe(digest(await readFile(path.join(host, 'node_modules/pdfjs-dist-v5/wasm', name))));
  }
  expect((await runtime.page.request.get(runtime.url() + PDF5_RESOURCE_PREFIX + 'invalid/example.txt')).status()).toBe(403);
}

describe('exact reader fixture and PDF5 runtime', () => {
  it('keeps separate exact profiles and rejects range/install aliases', () => {
    expect(projectPackage(versions).dependencies).toMatchObject(versions);
    for (const [name, version] of Object.entries(versions)) for (const bad of ['^' + version, '~' + version, 'npm:' + name + '@' + version]) expect(() => projectPackage({ [name]: bad })).toThrow();
    expect(() => assertPortableBinaryResource('src/arbitrary.pdf', pdf())).toThrow();
  });
  it('rejects private credentials and executable/link content from the protected Markdown proof', () => {
    for (const suffix of ['\n[example](https://example.invalid)', '\n<script>example()</script>', '\n```js\nexample()\n```', '\napi_key="ghp_' + 'A'.repeat(40) + '"']) expect(() => proveReaderMarkdownFixture(Buffer.from(shortWords + suffix))).toThrow();
  });
  it('requires precise roles, paths, digests and unchanged committed bytes without opening generic paths', async () => {
    const f = await fixture(); const valid = await packPreparedEngineeringBundle(f.config), origin = JSON.parse(valid.sourceFiles.find(file => file.path === 'src/rdesign-prepared-origin.json')!.content);
    expect(origin.readerMarkdownFixtureProof).toMatchObject({ sourceSha256: digest(shortWords), plainTextOnly: true }); expect(origin.readerPdfFixtureProofs[0]).toMatchObject({ sourceSha256: digest(f.bytes), parsingVerified: false });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerMarkdownFixture: undefined })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerPdfFixtures: [] })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerPdfFixtures: [{ sourcePath: 'fixtures/r-md-workspace/09-pdf/private.pdf', sourceSha256: digest(f.bytes) }] })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerMarkdownFixture: { sourceSha256: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerPdfFixtures: [{ sourcePath: pdfPath, sourceSha256: '0'.repeat(64) }] })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    await expect(packPreparedEngineeringBundle({ ...f.config, readerPdfFixtures: [f.config.readerPdfFixtures![0], f.config.readerPdfFixtures![0]] })).rejects.toMatchObject({ code: 'ENGINEERING_READER_FIXTURE' });
    const ledger = structuredClone(f.ledger); delete (ledger.stagedFiles[0] as any).sourceRole; await writeFile(path.join(f.prepared, 'src/origin.json'), JSON.stringify(ledger));
    await expect(packPreparedEngineeringBundle(f.config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
    await writeFile(path.join(f.prepared, 'src/origin.json'), JSON.stringify(f.ledger)); await writeFile(path.join(f.upstream, READER_MARKDOWN_SOURCE), 'dirty working tree stays private');
    const unchanged = await packPreparedEngineeringBundle(f.config); expect(unchanged.sourceFiles.find(file => file.path === READER_MARKDOWN_PREPARED)?.content).toBe(shortWords);
    expect(await readFile(path.join(f.upstream, READER_MARKDOWN_SOURCE), 'utf8')).toBe('dirty working tree stays private');
    await writeFile(path.join(f.prepared, READER_MARKDOWN_PREPARED), shortWords + '\nChanged');
    await expect(packPreparedEngineeringBundle(f.config)).rejects.toMatchObject({ code: 'ENGINEERING_PROVENANCE' });
  });
  it('keeps the canonical source boundary inside project-owned Worker builds', async () => {
    const f = await fixture(); await writeFile(path.join(f.root, 'outside.ts'), 'export const outside = "Synthetic outside source";');
    await writeFile(path.join(f.prepared, 'src/markdown.worker.ts'), "import {outside} from '../../outside.ts'; self.postMessage(outside);");
    const runtime = new BrowserRuntime(f.prepared, host);
    await expect(runtime.build()).rejects.toThrow('outside the authorized preview boundary');
  });
  it('uses original project-source workers, actual Markdown/math/Mermaid/PDF5 and vendor resources through candidate/apply/revert', async () => {
    const f = await fixture(), bundle = await packPreparedEngineeringBundle(f.config), legacy = path.join(host, 'fixtures/react-monitor'), data = path.join(f.root, 'catalog');
    const legacyStore = await new DocumentStore(data).load(await codeHash(legacy)), catalog = await new ProjectWorkspace(data, legacy, host).load(legacyStore.project), imported = await catalog.import(bundle), entry = await catalog.validate(imported.id), store = await new DocumentStore(entry.dataDirectory).load(await codeHash(entry.sourceDirectory));
    const runtime = new BrowserRuntime(entry.sourceDirectory, host, 'live', 0, entry.dataDirectory); const errors: string[] = [];
    try { await runtime.build(); await runtime.start(); runtime.page.on('pageerror', error => errors.push(error.message)); await assertReader(runtime);
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'reader-title')!, engine = new ChangeEngine(store, runtime, host);
      const change = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Verify real reader dependencies', properties: { text: 'Reader candidate checked' }, scope: 'instance' });
      await engine.verify(change.id); expect(change.status).toBe('verified');
      expect(change.candidateFrame?.nodes.find(node => node.sourceNodeId === 'worker-ruby-proof')?.text).toContain('class LocalReader');
      expect(change.candidateFrame?.nodes.find(node => node.sourceNodeId === 'worker-perl-proof')?.text).toContain('sub local_reader');
      await engine.apply(change.id, change.diffHash); await runtime.capture(); await assertReader(runtime);
      expect(await runtime.page.locator('[data-rdesign-id="reader-title"]').textContent()).toBe('Reader candidate checked'); await engine.revert(change.id); await runtime.capture(); await assertReader(runtime);
      expect(await runtime.page.locator('[data-rdesign-id="reader-title"]').textContent()).toBe('Synthetic reader'); expect(errors).toEqual([]);
    } catch (error) {
      if (runtime.page) console.error('Reader diagnostic:', JSON.stringify(await runtime.page.evaluate(() => ({ body: document.body.innerText.slice(0,1500), fixture: (window as any).__READER_FIXTURE__, resources: performance.getEntriesByType('resource').slice(-12).map(item => ({ name: item.name, duration: item.duration })) })).catch(() => null)));
      throw error;
    } finally { await runtime.close(); }
  }, 180000);
});
