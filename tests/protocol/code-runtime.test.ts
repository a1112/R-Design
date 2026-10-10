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
  '@radix-ui/react-alert-dialog': '1.1.23', '@radix-ui/react-checkbox': '1.3.11', '@radix-ui/react-label': '2.1.15',
  '@radix-ui/react-radio-group': '1.4.7', '@radix-ui/react-scroll-area': '1.2.18', '@radix-ui/react-switch': '1.3.7',
  '@radix-ui/react-tabs': '1.1.21', zustand: '5.0.15', 'lucide-react-v116': '1.16.0', 'monaco-editor': '0.57.0',
};
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// Original synthetic code only. No private application, user files or backend fixtures.
const main = `import React,{useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import *as Alert from '@radix-ui/react-alert-dialog';import *as Checkbox from '@radix-ui/react-checkbox';import *as Label from '@radix-ui/react-label';import *as Radio from '@radix-ui/react-radio-group';import *as Scroll from '@radix-ui/react-scroll-area';import *as Switch from '@radix-ui/react-switch';import *as Tabs from '@radix-ui/react-tabs';import {create} from 'zustand';import {Code} from 'lucide-react-v116';
import *as monaco from 'monaco-editor/editor/editor.api';import {createWebWorker} from 'monaco-editor/internal/common/workers';
import 'monaco-editor/languages/definitions/typescript/register';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';import cssWorker from 'monaco-editor/language/css/css.worker?worker';import htmlWorker from 'monaco-editor/language/html/html.worker?worker';import jsonWorker from 'monaco-editor/language/json/json.worker?worker';import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
const diagnostics={workers:[],results:null,error:null};const constructors={json:jsonWorker,css:cssWorker,html:htmlWorker,typescript:tsWorker};
globalThis.MonacoEnvironment={getWorker(_id,label){const worker=new(constructors[label]??editorWorker)();const entry={label,sent:0,received:0,errors:[]};diagnostics.workers.push(entry);const post=worker.postMessage.bind(worker);worker.postMessage=(...args)=>{entry.sent++;return post(...args)};worker.addEventListener('message',()=>entry.received++);worker.addEventListener('error',e=>entry.errors.push(e.message));return worker}};
const useCounter=create(set=>({count:0,increase:()=>set(state=>({count:state.count+1}))}));
async function probeWorkers(){const probes=[['json','{"broken":}',{languageId:'json',languageSettings:{validate:true,schemas:[]},enableSchemaRequest:false},'doValidation'],['css','a{color:red}',{languageId:'css',options:{validate:true}},'findDocumentColors'],['html','<h1>Synthetic</h1>',{languageId:'html',languageSettings:{}},'findDocumentSymbols'],['typescript','const answer: number = "wrong";',{compilerOptions:{},extraLibs:{},inlayHintsOptions:{}},'getSemanticDiagnostics']];const results={};for(const[label,text,createData,method]of probes){const uri=monaco.Uri.parse('inmemory://synthetic/probe.'+({json:'json',css:'css',html:'html',typescript:'ts'})[label]);const model=monaco.editor.createModel(text,'plaintext',uri);const worker=createWebWorker({moduleId:'synthetic-'+label,label,createData});try{await worker.withSyncedResources([uri]);const proxy=await worker.getProxy();const result=await proxy[method](uri.toString());results[label]={count:result.length,result:label==='typescript'?result.map(d=>({code:d.code})):result};}finally{worker.dispose();model.dispose();}}
return results;}
function App(){const ref=useRef(null),diffRef=useRef(null),[value,setValue]=useState('const answer = 1;'),[readonly,setReadonly]=useState(false),[checked,setChecked]=useState(false),[enabled,setEnabled]=useState(false),[choice,setChoice]=useState('one'),[tab,setTab]=useState('source'),[confirmed,setConfirmed]=useState(false);const count=useCounter(s=>s.count),increase=useCounter(s=>s.increase);
useEffect(()=>{const editor=monaco.editor.create(ref.current,{value:'const answer = 1;',language:'typescript',automaticLayout:true,minimap:{enabled:false}});const listener=editor.onDidChangeModelContent(()=>setValue(editor.getValue()));const original=monaco.editor.createModel('before','plaintext'),modified=monaco.editor.createModel('after','plaintext'),diff=monaco.editor.createDiffEditor(diffRef.current,{automaticLayout:true,readOnly:true});diff.setModel({original,modified});Object.assign(window,{__CODE_FIXTURE__:{editor,monaco,diff,diagnostics}});void probeWorkers().then(results=>{diagnostics.results=results}).catch(e=>{diagnostics.error=String(e)});return()=>{listener.dispose();editor.dispose();diff.dispose();original.dispose();modified.dispose()}},[]);
useEffect(()=>{window.__CODE_FIXTURE__?.editor.updateOptions({readOnly:readonly})},[readonly]);
return <main style={{padding:16,maxWidth:1000}}><h1 data-rdesign-id="code-fixture-title">Synthetic editor controls</h1><Code data-testid="new-icon"/><button data-testid="counter" onClick={increase}>Count {count}</button>
<Label.Root htmlFor="synthetic-check">Enable fixture</Label.Root><Checkbox.Root id="synthetic-check" checked={checked} onCheckedChange={v=>setChecked(v===true)}><Checkbox.Indicator>Checked</Checkbox.Indicator></Checkbox.Root><output data-testid="checked">{String(checked)}</output>
<Switch.Root aria-label="Synthetic switch" checked={enabled} onCheckedChange={setEnabled}/><output data-testid="enabled">{String(enabled)}</output>
<Radio.Root aria-label="Synthetic choice" value={choice} onValueChange={setChoice}><Radio.Item value="one" aria-label="One"/><Radio.Item value="two" aria-label="Two"/></Radio.Root><output data-testid="choice">{choice}</output>
<Tabs.Root value={tab} onValueChange={setTab}><Tabs.List aria-label="Synthetic tabs"><Tabs.Trigger value="source">Source</Tabs.Trigger><Tabs.Trigger value="notes">Notes</Tabs.Trigger></Tabs.List><Tabs.Content value="source">Source tab</Tabs.Content><Tabs.Content value="notes">Notes tab</Tabs.Content></Tabs.Root>
<Scroll.Root style={{height:64,width:280,overflow:'hidden'}}><Scroll.Viewport data-testid="scroll" style={{height:'100%',width:'100%'}}>{Array.from({length:20},(_,i)=><p key={i}>Synthetic row {i}</p>)}</Scroll.Viewport><Scroll.Scrollbar orientation="vertical"><Scroll.Thumb/></Scroll.Scrollbar></Scroll.Root>
<Alert.Root><Alert.Trigger data-testid="alert-trigger">Confirm example</Alert.Trigger><Alert.Portal><Alert.Overlay style={{position:'fixed',inset:0,background:'#0005'}}/><Alert.Content style={{position:'fixed',top:60,left:20,background:'white',padding:20}}><Alert.Title>Synthetic confirmation</Alert.Title><Alert.Description>Local example only</Alert.Description><Alert.Cancel>Cancel</Alert.Cancel><Alert.Action onClick={()=>setConfirmed(true)}>Confirm</Alert.Action></Alert.Content></Alert.Portal></Alert.Root><output data-testid="confirmed">{String(confirmed)}</output>
<button data-testid="readonly" onClick={()=>setReadonly(v=>!v)}>{readonly?'Read only':'Editable'}</button><output data-testid="draft">{value}</output><div ref={ref} style={{height:240,width:'100%'}}/><div ref={diffRef} style={{height:160,width:'100%'}}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rd-code-runtime-')); directories.push(root);
  const upstream = path.join(root, 'upstream'), prepared = path.join(root, 'prepared');
  await mkdir(path.join(upstream, 'web/src'), { recursive: true }); await mkdir(path.join(prepared, 'src'), { recursive: true });
  await writeFile(path.join(upstream, 'web/src/main.tsx'), main);
  await writeFile(path.join(upstream, 'web/package.json'), JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', ...versions } }));
  await run('git', ['init', upstream]); await run('git', ['-C', upstream, 'add', '.']);
  await run('git', ['-C', upstream, '-c', 'user.name=Code Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic editor fixture']);
  const commit = (await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim();
  const adapted = "import {installRuntime} from '@rdesign/runtime-web';\n" + main + '\ninstallRuntime();';
  const ledger = { schemaVersion: 1, source: { repository: 'example/code-frontend', commit }, stagedFiles: [{ sourcePath: 'web/src/main.tsx', path: 'src/main.tsx', sourceSha256: digest(main), sha256: digest(adapted) }], splitResources: [] };
  for (const [file, content] of Object.entries({ 'src/main.tsx': adapted, 'src/code-origin.json': JSON.stringify(ledger), 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'package.json': JSON.stringify(projectPackage(versions)) })) await writeFile(path.join(prepared, file), content);
  const config: PreparedEngineeringConfig = { repositoryRoot: upstream, repositoryUrl: 'https://github.com/example/code-frontend', commit, name: 'Synthetic Monaco compatibility', preparedDirectory: prepared, provenanceFile: 'src/code-origin.json', limitations: ['Synthetic local editor and controls; no application source, filesystem, model or native/backend success'], scenarios: [{ id: 'code-main', name: 'Editor', route: '/', viewport: { width: 1200, height: 820 }, readySelector: '[data-rdesign-id="code-fixture-title"]', steps: [], dependencies: ['src/main.tsx'], status: 'unverified' }] };
  return { root, prepared, config };
}

describe('pinned editor browser runtime', () => {
  it('accepts the ten exact versions and rejects ranges/install aliases', () => {
    expect(projectPackage(versions).dependencies).toMatchObject(versions);
    for (const [name, version] of Object.entries(versions)) for (const invalid of ['0.0.0', '^' + version, '~' + version, 'npm:' + name + '@' + version]) expect(() => projectPackage({ [name]: invalid })).toThrow();
  });
  it('rejects resigned portable packages with any changed new dependency version', async () => {
    const { config } = await fixture(), valid = await packPreparedEngineeringBundle(config);
    for (const [name, version] of Object.entries(versions)) {
      const malformed = structuredClone(valid), item = malformed.sourceFiles.find(f => f.path === 'package.json')!;
      const parsed = JSON.parse(item.content); parsed.dependencies[name] = '^' + version; item.content = JSON.stringify(parsed); item.sha256 = digest(item.content);
      const { checksum: _, ...payload } = malformed; malformed.checksum = digest(JSON.stringify(payload));
      expect(() => validatePortableProjectBundle(malformed)).toThrow();
    }
  });
  it('officially packs/imports without local node_modules, executes five workers and controls, and applies/reverts a built candidate', async () => {
    const { root, config } = await fixture(), bundle = await packPreparedEngineeringBundle(config);
    validatePortableProjectBundle(bundle); expect(preflightEngineeringBundle(bundle).passed).toBe(true);
    const data = path.join(root, 'catalog'), linked = path.join(host, 'fixtures/react-monitor');
    const seed = await new DocumentStore(data).load(await codeHash(linked)), catalog = await new ProjectWorkspace(data, linked, host).load(seed.project);
    const first = await catalog.import(bundle), second = await catalog.import(bundle); expect(first.id).not.toBe(second.id);
    const source = await catalog.validate(first.id); await expect(readFile(path.join(source.sourceDirectory, 'node_modules/package.json'))).rejects.toThrow();
    const store = await new DocumentStore(source.dataDirectory).load(await codeHash(source.sourceDirectory)), runtime = new BrowserRuntime(source.sourceDirectory, host, 'live', 0, source.dataDirectory);
    try {
      await runtime.build(); await runtime.start(); const page = runtime.page, errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => Boolean((window as any).__CODE_FIXTURE__?.diagnostics.results || (window as any).__CODE_FIXTURE__?.diagnostics.error));
      const diagnostic = await page.evaluate(() => (window as any).__CODE_FIXTURE__.diagnostics);
      expect(diagnostic.error).toBeNull(); for (const label of ['json', 'css', 'html', 'typescript']) expect(diagnostic.results[label].count).toBeGreaterThan(0);
      expect(diagnostic.results.typescript.result).toContainEqual({ code: 2322 });
      await page.waitForFunction(() => (window as any).__CODE_FIXTURE__.diff.getLineChanges()?.length > 0);
      const workers = await page.evaluate(() => (window as any).__CODE_FIXTURE__.diagnostics.workers);
      for (const label of ['editorWorkerService', 'json', 'css', 'html', 'typescript']) expect(workers.some((worker: any) => worker.label === label && worker.sent > 0 && worker.received > 0 && !worker.errors.length)).toBe(true);
      await page.evaluate(() => (window as any).__CODE_FIXTURE__.editor.focus()); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('const edited = 42;');
      await expect.poll(() => page.getByTestId('draft').textContent()).toBe('const edited = 42;');
      expect(await page.evaluate(() => (window as any).__CODE_FIXTURE__.monaco.editor.tokenize('const answer = 1;', 'typescript')[0].some((token: any) => token.type.includes('keyword')))).toBe(true);
      await page.getByTestId('readonly').click(); await page.evaluate(() => (window as any).__CODE_FIXTURE__.editor.focus()); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('blocked'); expect(await page.getByTestId('draft').textContent()).toBe('const edited = 42;');
      await page.getByTestId('counter').click(); expect(await page.getByTestId('counter').textContent()).toBe('Count 1');
      await page.getByText('Enable fixture', { exact: true }).click(); expect(await page.getByTestId('checked').textContent()).toBe('true');
      await page.getByRole('switch', { name: 'Synthetic switch' }).click(); expect(await page.getByTestId('enabled').textContent()).toBe('true');
      await page.getByRole('radio', { name: 'Two', exact: true }).click(); expect(await page.getByTestId('choice').textContent()).toBe('two');
      await page.getByRole('tab', { name: 'Notes', exact: true }).click(); await page.getByRole('tabpanel').filter({ hasText: 'Notes tab' }).waitFor();
      const scroll = page.getByTestId('scroll'); await scroll.evaluate(element => { element.scrollTop = 80; }); expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await page.getByTestId('alert-trigger').click(); const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await expect.poll(() => page.getByTestId('alert-trigger').evaluate(element => document.activeElement === element)).toBe(true);
      await page.getByTestId('alert-trigger').click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); expect(await page.getByTestId('confirmed').textContent()).toBe('true');
      expect(await page.getByTestId('new-icon').count()).toBe(1);
      const outside = path.join(root, 'outside.ts'); await writeFile(outside, 'export const syntheticOutside = true;');
      expect((await page.request.get(runtime.url() + '/@fs/' + outside)).status()).toBe(403);
      const frame = await runtime.capture(), target = frame.nodes.find(node => node.sourceNodeId === 'code-fixture-title')!; expect(target.binding?.reliability).toBe('exact');
      const engine = new ChangeEngine(store, runtime, host), candidate = await engine.prepare({ projectId: store.project.id, expectedRevision: store.project.revision, operationId: randomUUID(), nodeId: target.runtimeNodeId, sourceNodeId: target.sourceNodeId!, version: frame, intent: 'Synthetic editor heading', properties: { text: 'Editor controls checked' }, scope: 'instance' });
      await engine.verify(candidate.id); expect(candidate.status, JSON.stringify(candidate.evidence)).toBe('verified'); expect(candidate.evidence.every(item => item.passed)).toBe(true);
      await engine.apply(candidate.id, candidate.diffHash); await runtime.capture(); expect(await page.locator('h1').textContent()).toBe('Editor controls checked');
      await engine.revert(candidate.id); await runtime.capture(); expect(await page.locator('h1').textContent()).toBe('Synthetic editor controls'); expect(errors).toEqual([]);
    } finally { await runtime.close(); }
  }, 180000);
});
