import { test, expect, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BridgeState, ProjectSummary, WorkspaceCatalog, Annotation } from '../../packages/protocol/src/index';
import { BridgeClient, FrameObserver, baseURL, runtimeVersion } from './bridge-client';

test.describe.configure({ timeout: 240_000 });
let originalProjectId='';
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const unique=(label:string)=>`${label} ${randomUUID().slice(0,8)}`;
interface PortableBundle { format:string; schemaVersion:number; checksum:string; manifest:{name:string;id:string;[key:string]:unknown}; document:{schemaVersion:number;project:BridgeState['project'];changes:BridgeState['changes']}; sourceFiles:Array<{path:string;content:string;encoding?:string;sha256:string}> }
async function catalog(client:BridgeClient):Promise<WorkspaceCatalog>{const r=await client.request.get(`${baseURL}/api/projects`,{headers:client.headers});expect(r.ok(),await r.text()).toBeTruthy();return r.json();}
async function catalogWrite(client:BridgeClient,endpoint:string,extra:object={}){const state=await catalog(client);return client.post(`/projects${endpoint}`,{expectedRevision:state.revision,operationId:randomUUID(),...extra});}
async function create(client:BridgeClient,name:string,template:'blank'|'react-monitor'){const r=await catalogWrite(client,'',{name,template});return (await r.json()).project as ProjectSummary;}
async function open(client:BridgeClient,id:string){await catalogWrite(client,`/${id}/open`);await expect.poll(async()=>(await client.state()).project.id).toBe(id);return client.live();}
async function bundle(client:BridgeClient,id:string):Promise<PortableBundle>{const r=await client.request.get(`${baseURL}/api/projects/${id}/export`,{headers:client.headers});expect(r.ok(),await r.text()).toBeTruthy();return r.json();}
async function newFromUI(page:Page,client:BridgeClient,name:string,template:'blank'|'react-monitor'){
  await page.getByTestId('new-project').click();await page.getByTestId('project-name').fill(name);
  await page.getByTestId(`template-${template}`).click();await page.getByTestId('create-project').click();
  await expect(page.getByTestId('canvas-surface')).toBeVisible({timeout:60_000});
  await expect.poll(async()=>(await client.state()).project.name).toBe(name);
  const project=(await catalog(client)).projects.find(project=>project.name===name)!;expect(project).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));return project;
}
async function home(page:Page){await page.getByTestId('home-return').click();await expect(page.getByTestId('home-page')).toBeVisible();await expect(page).toHaveURL(`${baseURL}/`);}
async function openFromUI(page:Page,client:BridgeClient,id:string){await page.getByTestId(`open-project-${id}`).click();await expect(page.getByTestId('canvas-surface')).toBeVisible({timeout:60_000});await expect.poll(async()=>(await client.state()).project.id).toBe(id);await expect(page).toHaveURL(new RegExp(`/project/${id}$`));}
async function savedComment(page:Page,client:BridgeClient,text:string){await page.locator('.inspector-tabs').getByRole('button',{name:/^批注/}).click();await page.getByTestId('annotation-text').fill(text);await expect(page.getByTestId('save-annotation')).toBeEnabled();await page.getByTestId('save-annotation').click();await expect.poll(async()=>(await client.state()).project.annotations.filter(a=>a.text===text).length).toBe(1);}
async function addDesign(client:BridgeClient,name:string){const id=randomUUID();await client.post('/design-frames',{...(await client.envelope()),frame:{id,name,nodes:[{id:randomUUID(),type:'text',bounds:{x:40,y:40,w:240,h:60},text:name,color:'#168bff'}]}});return id;}

test.beforeEach(async({request})=>{const client=await new BridgeClient(request).connect();const state=await client.live();if(!originalProjectId)originalProjectId=state.project.id;});
test.afterEach(async({request})=>{if(!originalProjectId)return;const client=await new BridgeClient(request).connect();await open(client,originalProjectId);});

test('home creates two real engineering projects and keeps documents, source files and unsaved drafts isolated through switching and reload',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const client=await new BridgeClient(request).connect();await page.setViewportSize({width:1440,height:1000});await page.goto(baseURL);
  await expect(page.getByTestId('home-page')).toBeVisible();
  const a=await newFromUI(page,client,unique('独立空白工程 A'),'blank');
  expect((await client.live()).frame.nodes.some(node=>node.sourceNodeId==='welcome-title'&&node.text==='从一个想法开始')).toBeTruthy();
  const aDesign=await addDesign(client,'A 唯一设计画板');
  const aComment='A 独有的已保存批注';await savedComment(page,client,aComment);
  const aDraft='A 尚未保存的本机草稿';await page.getByTestId('annotation-text').fill(aDraft);
  await home(page);
  const b=await newFromUI(page,client,unique('独立 React 工程 B'),'react-monitor');
  expect(a.location).not.toBe(b.location);
  await page.locator('.inspector-tabs').getByRole('button',{name:/^批注/}).click();
  await expect(page.getByTestId('annotation-text')).toHaveValue('');
  const initialB=await client.state();expect(initialB.project.annotations).toEqual([]);expect(initialB.project.designFrames).toEqual([]);
  const bDesign=await addDesign(client,'B 唯一设计画板');
  const bComment='B 独有的已保存批注';await savedComment(page,client,bComment);
  const bDraft='B 尚未保存的本机草稿';await page.getByTestId('annotation-text').fill(bDraft);await home(page);
  await openFromUI(page,client,a.id);
  await page.locator('.inspector-tabs').getByRole('button',{name:/^批注/}).click();await expect(page.getByTestId('annotation-text')).toHaveValue(aDraft);
  let state=await client.state();expect(state.project.designFrames.map(f=>f.id)).toContain(aDesign);expect(state.project.designFrames.map(f=>f.id)).not.toContain(bDesign);
  expect(state.project.annotations.map(a=>a.text)).toContain(aComment);expect(state.project.annotations.map(a=>a.text)).not.toContain(bComment);
  await page.reload();await expect(page.getByTestId('canvas-surface')).toBeVisible({timeout:60_000});
  await page.locator('.inspector-tabs').getByRole('button',{name:/^批注/}).click();await expect(page.getByTestId('annotation-text')).toHaveValue(aDraft);
  const aSource=path.join(a.location,'src/main.tsx'),bSource=path.join(b.location,'src/main.tsx');
  const marker='// A engineering source remains isolated from B.';await writeFile(aSource,(await readFile(aSource,'utf8'))+'\n'+marker+'\n');
  expect(await readFile(bSource,'utf8')).not.toContain(marker);
  await home(page);await openFromUI(page,client,b.id);
  await page.locator('.inspector-tabs').getByRole('button',{name:/^批注/}).click();await expect(page.getByTestId('annotation-text')).toHaveValue(bDraft);
  state=await client.state();expect(state.project.designFrames.map(f=>f.id)).toContain(bDesign);expect(state.project.designFrames.map(f=>f.id)).not.toContain(aDesign);
  expect(state.project.annotations.map(a=>a.text)).toContain(bComment);expect(state.project.annotations.map(a=>a.text)).not.toContain(aComment);
  expect((await bundle(client,a.id)).sourceFiles.find(file=>file.path==='src/main.tsx')!.content).toContain(marker);
  expect((await bundle(client,b.id)).sourceFiles.find(file=>file.path==='src/main.tsx')!.content).not.toContain(marker);
  expect(errors).toEqual([]);
});

test('project management persists rename/favorite/archive and imports a portable code/document/binary bundle into a new independent engineering project',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const client=await new BridgeClient(request).connect();await page.setViewportSize({width:1440,height:1000});await page.goto(baseURL);
  const p=await newFromUI(page,client,unique('管理工程'),'react-monitor');
  const note='便携工程内的批注';await savedComment(page,client,note);const designId=await addDesign(client,'便携设计画板');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5LkAAAAASUVORK5CYII=','base64');
  await mkdir(path.join(p.location,'public'),{recursive:true});await writeFile(path.join(p.location,'public/scope-pixel.png'),png);
  await home(page);await page.getByTestId(`project-menu-${p.id}`).click();await page.getByTestId('favorite-project').click();
  await expect.poll(async()=>(await catalog(client)).projects.find(project=>project.id===p.id)?.favorite).toBeTruthy();
  await page.getByTestId(`project-menu-${p.id}`).click();await page.getByTestId('rename-project').click();const renamed=unique('已重命名工程');
  await page.getByTestId('project-name').fill(renamed);await page.getByTestId('save-project-name').click();await expect(page.getByTestId(`project-card-${p.id}`)).toContainText(renamed);
  await page.getByTestId(`project-menu-${p.id}`).click();await page.getByTestId('archive-project').click();
  await expect(page.locator('.home-error')).toContainText('PROJECT_ACTIVE');expect((await catalog(client)).projects.find(project=>project.id===p.id)?.archived).toBeFalsy();
  await openFromUI(page,client,originalProjectId);await home(page);
  await page.getByTestId(`project-menu-${p.id}`).click();await page.getByTestId('archive-project').click();await expect(page.getByTestId(`project-card-${p.id}`)).toHaveCount(0);
  await page.locator('.home-nav').getByRole('button',{name:/^归档/}).click();await expect(page.getByTestId(`project-card-${p.id}`)).toBeVisible();await expect(page.getByTestId(`open-project-${p.id}`)).toBeDisabled();
  const rejectArchived=await client.post(`/projects/${p.id}/open`,{expectedRevision:(await catalog(client)).revision,operationId:randomUUID()},409);expect((await rejectArchived.json()).error.code).toBe('PROJECT_ARCHIVED');
  await page.getByTestId(`project-menu-${p.id}`).click();await page.getByTestId('restore-project').click();
  await page.locator('.home-nav').getByRole('button',{name:/^全部工程/}).click();await expect(page.getByTestId(`project-card-${p.id}`)).toBeVisible();await page.reload();
  await expect(page.getByTestId(`project-card-${p.id}`)).toContainText(renamed);const persisted=(await catalog(client)).projects.find(project=>project.id===p.id)!;expect(persisted.favorite).toBeTruthy();expect(persisted.archived).toBeFalsy();
  const exported=await bundle(client,p.id);const {checksum,...payload}=exported;expect(hash(JSON.stringify(payload))).toBe(checksum);
  const binary=exported.sourceFiles.find(file=>file.path==='public/scope-pixel.png')!;expect(binary.encoding).toBe('base64');expect(Buffer.from(binary.content,'base64')).toEqual(png);expect(binary.sha256).toBe(hash(png));
  const previous=(await catalog(client)).projects.map(project=>project.id);
  const chooser=page.waitForEvent('filechooser');await page.getByTestId('project-home-import').click();await (await chooser).setFiles({name:'portable.rdesign.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await expect.poll(async()=>(await catalog(client)).projects.length).toBe(previous.length+1);const imported=(await catalog(client)).projects.find(project=>!previous.includes(project.id))!;
  expect(imported.id).not.toBe(p.id);expect(imported.location).not.toBe(p.location);
  const importedBundle=await bundle(client,imported.id);expect(importedBundle.document.project.annotations.find(annotation=>annotation.text===note)?.projectId).toBe(imported.id);
  expect(importedBundle.document.project.designFrames.map(frame=>frame.id)).toContain(designId);
  expect(importedBundle.sourceFiles.find(file=>file.path==='src/main.tsx')?.content).toBe(exported.sourceFiles.find(file=>file.path==='src/main.tsx')?.content);
  expect(Buffer.from(importedBundle.sourceFiles.find(file=>file.path==='public/scope-pixel.png')!.content,'base64')).toEqual(png);
  await page.getByTestId('project-search').fill(renamed);await expect(page.locator('.home-project-card')).toHaveCount(2);
  await page.getByTestId('project-view-list').click();await expect(page.getByTestId('project-view-list')).toHaveAttribute('aria-pressed','true');await page.reload();await expect(page.getByTestId('project-view-list')).toHaveAttribute('aria-pressed','true');
  await page.getByTestId('project-view-grid').click();await page.setViewportSize({width:390,height:844});await expect(page.getByTestId('home-page')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:'test-results/project-home-mobile.png',fullPage:true});expect(errors).toEqual([]);
});

test('a paired device remains bound to engineering A after desktop opens B and cannot leak or manage B through HTTP, WS or Home',async({page,browser,request})=>{
  const client=await new BridgeClient(request).connect();const a=await create(client,unique('设备授权 A'),'blank');const b=await create(client,unique('设备隔离 B'),'react-monitor');
  const stateA=await open(client,a.id);const annotation:Annotation=await client.annotation('不应写入另一个工程');
  const foreign=await client.post('/annotations',{...(await client.envelope()),annotation:{...annotation,projectId:b.id}},409);expect((await foreign.json()).error.code).toBe('PROJECT_MISMATCH');expect((await client.state()).project.annotations).toEqual([]);
  const codeResponse=await client.post('/pairing/code',await client.envelope());const {code}=await codeResponse.json();
  const redeem=await request.post(`${baseURL}/api/pairing/redeem`,{data:{code,name:'仅授权 A 的测试设备'}});expect(redeem.ok()).toBeTruthy();const {token,deviceId}=await redeem.json();
  const observer=await FrameObserver.connect(token);let deviceContext:BrowserContext|undefined;
  try{
    deviceContext=await browser.newContext({viewport:{width:1024,height:900}});const devicePage=await deviceContext.newPage();const errors:string[]=[];devicePage.on('pageerror',error=>errors.push(error.message));
    await devicePage.goto(`${baseURL}/project/${a.id}?token=${token}`);await expect(devicePage.getByTestId('canvas-surface')).toBeVisible({timeout:60_000});
    const closed=new Promise<number>(resolve=>observer.socket.once('close',resolve));await open(client,b.id);expect(await closed).toBe(1008);
    await expect(devicePage.getByTestId('home-page')).toBeVisible({timeout:30_000});expect(await devicePage.evaluate(()=>sessionStorage.getItem('rd-token'))).toBe(token);
    await expect(devicePage.getByTestId('new-project')).toHaveCount(0);await expect(devicePage.getByTestId(`project-card-${a.id}`)).toBeVisible();await expect(devicePage.getByTestId(`project-card-${b.id}`)).toHaveCount(0);
    const deviceHeaders={Authorization:`Bearer ${token}`};
    for(const endpoint of ['/api/state','/api/export',`/api/projects/${b.id}/export`]){const response=await request.get(`${baseURL}${endpoint}`,{headers:deviceHeaders});expect(response.status()).toBe(403);expect((await response.json()).error.code).toBe('PROJECT_SCOPE');}
    const restricted=await request.get(`${baseURL}/api/projects`,{headers:deviceHeaders});const scoped:WorkspaceCatalog=await restricted.json();expect(scoped.canManage).toBeFalsy();expect(scoped.projects.map(project=>project.id)).toEqual([a.id]);expect(scoped.projects[0].location).toBe('');expect(JSON.stringify(scoped)).not.toContain(b.id);
    const createDenied=await request.post(`${baseURL}/api/projects`,{headers:deviceHeaders,data:{expectedRevision:scoped.revision,operationId:randomUUID(),name:'越权工程',template:'blank'}});expect(createDenied.status()).toBe(403);
    const ownExport=await request.get(`${baseURL}/api/projects/${a.id}/export`,{headers:deviceHeaders});expect(ownExport.ok()).toBeTruthy();expect((await ownExport.json()).document.project.id).toBe(a.id);
    expect(observer.events.filter(event=>event.type==='state').every(event=>event.type==='state'&&event.state.project.id===a.id)).toBeTruthy();expect(observer.frames.every(frame=>frame.runtimeSessionId===stateA.frame.runtimeSessionId)).toBeTruthy();
    const bRuntime=(await client.live()).frame.runtimeSessionId;expect(observer.frames.some(frame=>frame.runtimeSessionId===bRuntime)).toBeFalsy();expect(errors).toEqual([]);
    await page.goto(baseURL);await expect(page.getByTestId('home-page')).toBeVisible();
  }finally{observer.close();await deviceContext?.close();await client.post(`/devices/${deviceId}/revoke`,await client.envelope());}
});

test('a completed A write with a delayed acknowledgement cannot activate a queued A write or navigate engineering B after A editor unmounts',async({page,request})=>{
  const client=await new BridgeClient(request).connect();const a=await create(client,unique('延迟响应 A'),'blank');const b=await create(client,unique('异步保护 B'),'react-monitor');
  await open(client,a.id);await page.setViewportSize({width:1440,height:1000});await page.goto(`${baseURL}/project/${a.id}`);await expect(page.getByTestId('canvas-surface')).toBeVisible({timeout:60_000});
  let releaseAcknowledgement!:()=>void;const acknowledgementHeld=new Promise<void>(resolve=>{releaseAcknowledgement=resolve;});
  let firstApplied!:()=>void;const firstAppliedToServer=new Promise<void>(resolve=>{firstApplied=resolve;});
  let acknowledgementReleased!:()=>void;const firstAcknowledgementReleased=new Promise<void>(resolve=>{acknowledgementReleased=resolve;});
  const viewportWrites:Array<{projectId:string;width:number;height:number}>=[];
  await page.route('**/api/viewport',async route=>{
    viewportWrites.push(route.request().postDataJSON());
    if(viewportWrites.length===1){
      // Run the actual Bridge write, delaying only the response to the old editor.
      const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();firstApplied();
      await acknowledgementHeld;await route.fulfill({response});acknowledgementReleased();
    }else await route.continue();
  });
  try{
    await page.locator('.canvas-subbar').getByRole('button',{name:'桌面',exact:true}).click();await firstAppliedToServer;
    expect((await client.live()).frame.width).toBe(1100);expect(viewportWrites.map(write=>write.projectId)).toEqual([a.id]);
    await page.locator('.canvas-subbar').getByRole('button',{name:'窄屏',exact:true}).click();
    await home(page);await openFromUI(page,client,b.id);const beforeRelease=await client.live();
    releaseAcknowledgement();await firstAcknowledgementReleased;
    // Wait for a real subsequent B frame, allowing old promise callbacks to settle.
    await expect.poll(async()=>(await client.state()).frame?.id).not.toBe(beforeRelease.frame.id);
    await expect(page).toHaveURL(new RegExp(`/project/${b.id}$`));await expect(page.getByTestId('canvas-surface')).toBeVisible();await expect(page.getByTestId('home-page')).toHaveCount(0);
    const afterRelease=await client.live();expect(afterRelease.project.id).toBe(b.id);expect([afterRelease.frame.width,afterRelease.frame.height]).toEqual([beforeRelease.frame.width,beforeRelease.frame.height]);
    expect(viewportWrites).toHaveLength(1);expect(viewportWrites[0]).toMatchObject({projectId:a.id,width:1100,height:740});
  }finally{releaseAcknowledgement();}
});
