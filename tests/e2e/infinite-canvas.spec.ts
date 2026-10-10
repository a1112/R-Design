import { test, expect, type Page } from '@playwright/test';
import type { Camera } from '../../packages/canvas-core/src/index';
import type { RuntimeFrame, ObservedNode, ChangeSet, Stroke } from '../../packages/protocol/src/index';
import { BridgeClient, baseURL, runtimeVersion } from './bridge-client';

test.describe.configure({ timeout: 240_000 });

interface WorkbenchCanvasAPI {
  frame(): RuntimeFrame | null;
  nativeTarget(): { x:number; y:number; w:number; h:number; frameWidth:number; frameHeight:number; frameId:string } | null;
}
async function camera(page: Page): Promise<Camera> {
  return page.getByTestId('infinite-viewport').evaluate(element => ({
    x: Number(element.getAttribute('data-camera-x')), y: Number(element.getAttribute('data-camera-y')),
    zoom: Number(element.getAttribute('data-camera-zoom')),
  }));
}
async function openCanvas(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/editor`);
  await expect(page.getByTestId('canvas-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('infinite-viewport')).toBeVisible();
  await expect(page.locator('.connection')).toContainText('Bridge 已连接');
  await page.getByTestId('canvas-fit').click();
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(0);
}
async function sourceTarget(page: Page, sourceNodeId='start-button') {
  return page.evaluate(id => {
    const frame = (window as unknown as { __RDESIGN_WORKBENCH__: WorkbenchCanvasAPI }).__RDESIGN_WORKBENCH__.frame()!;
    return { width:frame.width, height:frame.height, frameId:frame.id, node:frame.nodes.find(node => node.sourceNodeId === id)! };
  }, sourceNodeId);
}
async function targetPoint(page: Page, node: ObservedNode) {
  const box = (await page.getByTestId('canvas-surface').boundingBox())!;
  const source = await sourceTarget(page);
  return { x:box.x+(node.bounds.x+node.bounds.w/2)*box.width/source.width, y:box.y+(node.bounds.y+node.bounds.h/2)*box.height/source.height };
}
async function drag(page: Page, start: {x:number;y:number}, delta: {x:number;y:number}, button:'left'|'middle'='left') {
  await page.mouse.move(start.x,start.y); await page.mouse.down({button});
  await page.mouse.move(start.x+delta.x,start.y+delta.y,{steps:6}); await page.mouse.up({button});
}

test('cursor zoom, unbounded two-axis pan, fit and 100% leave the real source viewport and inspector unchanged', async ({ page, request }) => {
  const client = await new BridgeClient(request).connect();
  const source = await client.live();
  let remoteInputs=0; page.on('request',req=>{if(new URL(req.url()).pathname==='/api/input')remoteInputs++;});
  await openCanvas(page);
  const viewport=page.getByTestId('infinite-viewport');
  const box=(await viewport.boundingBox())!;
  const inspector=(await page.locator('.inspector').boundingBox())!;
  const cursor={x:Math.round(box.x+box.width*.43),y:Math.round(box.y+box.height*.39)};
  const before=await camera(page);
  const documentPoint={x:(cursor.x-box.x-before.x)/before.zoom,y:(cursor.y-box.y-before.y)/before.zoom};
  await page.mouse.move(cursor.x,cursor.y);
  await page.keyboard.down('Control'); await page.mouse.wheel(0,-180); await page.keyboard.up('Control');
  await expect.poll(async()=> (await camera(page)).zoom).toBeGreaterThan(before.zoom);
  const zoomed=await camera(page);
  expect(zoomed.x+documentPoint.x*zoomed.zoom).toBeCloseTo(cursor.x-box.x,1);
  expect(zoomed.y+documentPoint.y*zoomed.zoom).toBeCloseTo(cursor.y-box.y,1);
  await page.keyboard.down('Meta'); await page.mouse.wheel(0,90); await page.keyboard.up('Meta');
  await expect.poll(async()=> (await camera(page)).zoom).toBeLessThan(zoomed.zoom);
  const cmdZoomed=await camera(page);
  expect(cmdZoomed.x+documentPoint.x*cmdZoomed.zoom).toBeCloseTo(cursor.x-box.x,1);
  expect(cmdZoomed.y+documentPoint.y*cmdZoomed.zoom).toBeCloseTo(cursor.y-box.y,1);
  await page.mouse.wheel(175,130);
  await expect.poll(async()=> (await camera(page)).x).toBeCloseTo(cmdZoomed.x-175,1);
  expect((await camera(page)).y).toBeCloseTo(cmdZoomed.y-130,1);
  expect((await camera(page)).zoom).toBeCloseTo(cmdZoomed.zoom,9);
  await page.mouse.wheel(6000,-9000);
  await expect.poll(async()=> Math.abs((await camera(page)).x)).toBeGreaterThan(box.width*3);
  expect(Math.abs((await camera(page)).y)).toBeGreaterThan(box.height*3);
  expect(await viewport.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}))).toEqual({x:0,y:0});
  await page.getByTestId('canvas-fit').click();
  const surface=page.getByTestId('canvas-surface');
  await surface.focus();
  await page.keyboard.press('Shift+Digit0');
  await expect.poll(async()=> (await camera(page)).zoom).toBeCloseTo(1,9);
  await expect(page.getByTestId('canvas-zoom-value')).toContainText('100%');
  await page.getByTestId('canvas-zoom-in').click();
  await expect.poll(async()=> (await camera(page)).zoom).toBeGreaterThan(1);
  await page.getByTestId('canvas-zoom-out').click();
  await expect.poll(async()=> (await camera(page)).zoom).toBeCloseTo(1,9);
  await page.getByTestId('canvas-zoom-value').click();
  await page.getByTestId('canvas-zoom-reset').click();
  await expect.poll(async()=> (await camera(page)).zoom).toBeCloseTo(1,9);
  await surface.focus(); await page.keyboard.press('Shift+Digit1');
  await expect.poll(async()=> (await camera(page)).zoom).toBeLessThan(1);
  const fitted=await surface.boundingBox();
  expect(fitted!.x).toBeGreaterThanOrEqual(box.x-1);
  expect(fitted!.x+fitted!.width).toBeLessThanOrEqual(box.x+box.width+1);
  expect(await page.locator('.inspector').boundingBox()).toEqual(inspector);
  const after=await client.live();
  expect([after.frame.width,after.frame.height,after.frame.viewportRevision,after.frame.runtimeSessionId,after.frame.epoch]).toEqual([source.frame.width,source.frame.height,source.frame.viewportRevision,source.frame.runtimeSessionId,source.frame.epoch]);
  expect(remoteInputs).toBe(0);
  await page.setViewportSize({width:390,height:844}); await page.getByTestId('canvas-fit').click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByTestId('canvas-zoom-value').click();
  await page.getByTestId('canvas-zoom-reset').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('hand, Space drag and middle-button pan never dispatch business input or ink; H/V ignore focused fields', async ({ page }) => {
  let remoteInputs=0; page.on('request',req=>{if(new URL(req.url()).pathname==='/api/input')remoteInputs++;});
  await openCanvas(page);
  const surface=page.getByTestId('canvas-surface'); await surface.focus();
  await page.keyboard.press('h');
  await expect(page.getByTestId('infinite-viewport')).toHaveClass(/is-space/);
  const b=(await surface.boundingBox())!;
  let before=await camera(page);
  await drag(page,{x:b.x+b.width*.4,y:b.y+b.height*.4},{x:90,y:55});
  await expect.poll(async()=> (await camera(page)).x).toBeCloseTo(before.x+90,1);
  expect((await camera(page)).y).toBeCloseTo(before.y+55,1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`)??'[]'))).toEqual([]);
  await surface.focus(); await page.keyboard.press('v');
  await expect(page.getByTestId('mode-design')).toHaveClass(/active/);
  await expect(page.getByTestId('infinite-viewport')).not.toHaveClass(/is-space/);
  await page.getByTestId('canvas-fit').click();
  const interactionResponse=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/mode'&&res.request().method()==='POST'&&res.request().postDataJSON()?.mode==='interact');
  await page.getByTestId('mode-interact').click();
  const lease=await interactionResponse; expect(lease.ok(),await lease.text()).toBeTruthy();
  const interactionView=(await page.getByTestId('infinite-viewport').boundingBox())!;
  const interactionCamera=await camera(page);
  await page.mouse.move(Math.round(interactionView.x+interactionView.width*.5),Math.round(interactionView.y+interactionView.height*.45));
  await page.keyboard.down('Control'); await page.mouse.wheel(0,-50); await page.keyboard.up('Control');
  await expect.poll(async()=> (await camera(page)).zoom).toBeGreaterThan(interactionCamera.zoom);
  expect(remoteInputs).toBe(0); await page.getByTestId('canvas-fit').click();
  const area=(await surface.boundingBox())!;
  before=await camera(page);
  await drag(page,{x:area.x+area.width*.4,y:area.y+area.height*.4},{x:72,y:42},'middle');
  await expect.poll(async()=> (await camera(page)).x).toBeCloseTo(before.x+72,1);
  before=await camera(page); await surface.focus(); await page.keyboard.down('Space');
  const v=(await page.getByTestId('infinite-viewport').boundingBox())!;
  await drag(page,{x:v.x+v.width*.5,y:v.y+v.height*.4},{x:-95,y:63}); await page.keyboard.up('Space');
  await expect.poll(async()=> (await camera(page)).x).toBeCloseTo(before.x-95,1);
  expect((await camera(page)).y).toBeCloseTo(before.y+63,1);
  expect(remoteInputs).toBe(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`)??'[]'))).toEqual([]);
  await page.getByTestId('mode-design').click();
  await page.getByTestId('canvas-fit').click();
  await page.locator('.sidebar-tabs').getByRole('button',{name:'图层',exact:true}).click();
  await page.getByTestId('node-start-button').click();
  const field=page.getByTestId('property-text'); await field.fill('输入字段：');
  await field.press('End'); await page.keyboard.press('h'); await page.keyboard.press('v');
  await expect(field).toHaveValue('输入字段：hv');
  await expect(page.getByTestId('mode-design')).toHaveClass(/active/);
  await expect(page.getByTestId('infinite-viewport')).not.toHaveClass(/is-space/);
});

test('transformed object selection, pen coordinates and native target remain attached to the same source frame', async ({ page }) => {
  await openCanvas(page);
  const surface=page.getByTestId('canvas-surface');
  const source=await sourceTarget(page);
  const hit=await targetPoint(page,source.node);
  await page.mouse.move(hit.x,hit.y); await page.keyboard.down('Control'); await page.mouse.wheel(0,-70); await page.keyboard.up('Control');
  await page.mouse.wheel(45,30);
  const transformedHit=await targetPoint(page,source.node);
  await page.mouse.click(transformedHit.x,transformedHit.y);
  await expect(page.locator('.selection-heading')).toContainText('start-button');
  await expect(page.getByTestId('property-text')).toBeEnabled();
  const selectedBox=await surface.locator('.canvas-overlay rect').first().boundingBox();
  const box=(await surface.boundingBox())!;
  // The SVG bounding box includes its centered selection stroke; compare its center
  // and authored source geometry instead of treating stroke pixels as layout bounds.
  expect(selectedBox!.x+selectedBox!.width/2).toBeCloseTo(box.x+(source.node.bounds.x+source.node.bounds.w/2)*box.width/source.width,1);
  expect(selectedBox!.y+selectedBox!.height/2).toBeCloseTo(box.y+(source.node.bounds.y+source.node.bounds.h/2)*box.height/source.height,1);
  const authored=await surface.locator('.canvas-overlay rect').first().evaluate(el=>({x:Number(el.getAttribute('x')),y:Number(el.getAttribute('y')),w:Number(el.getAttribute('width')),h:Number(el.getAttribute('height'))}));
  expect(authored).toEqual(source.node.bounds);
  await page.getByTestId('mode-annotate').click();
  const frozenBox=(await surface.boundingBox())!;
  const frozen=await sourceTarget(page);
  const clippedView=(await page.getByTestId('infinite-viewport').boundingBox())!;
  const left=Math.max(frozenBox.x,clippedView.x)+20,top=Math.max(frozenBox.y,clippedView.y)+20;
  const right=Math.min(frozenBox.x+frozenBox.width,clippedView.x+clippedView.width)-20,bottom=Math.min(frozenBox.y+frozenBox.height,clippedView.y+clippedView.height)-80;
  const startScreen={x:Math.round(left+(right-left)*.35),y:Math.round(top+(bottom-top)*.4)};
  const endScreen={x:Math.round(left+(right-left)*.43),y:Math.round(top+(bottom-top)*.48)};
  await page.mouse.move(startScreen.x,startScreen.y);
  await page.mouse.down();
  await page.mouse.move(endScreen.x,endScreen.y,{steps:4}); await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`)??'[]').length)).toBe(1);
  const stroke:Stroke=await page.evaluate(()=>JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`)??'[]')[0]);
  expect(stroke.points[0].x).toBeCloseTo((startScreen.x-frozenBox.x)*frozen.width/frozenBox.width,1); expect(stroke.points[0].y).toBeCloseTo((startScreen.y-frozenBox.y)*frozen.height/frozenBox.height,1);
  expect(stroke.points.at(-1)!.x).toBeCloseTo((endScreen.x-frozenBox.x)*frozen.width/frozenBox.width,1); expect(stroke.points.at(-1)!.y).toBeCloseTo((endScreen.y-frozenBox.y)*frozen.height/frozenBox.height,1);
  const native=await page.evaluate(()=>(window as unknown as {__RDESIGN_WORKBENCH__:WorkbenchCanvasAPI}).__RDESIGN_WORKBENCH__.nativeTarget());
  expect(native?.frameId).toBe(frozen.frameId);
  expect([native?.frameWidth,native?.frameHeight]).toEqual([frozen.width,frozen.height]);
  expect(native!.x).toBeCloseTo(frozenBox.x,1); expect(native!.y).toBeCloseTo(frozenBox.y,1);
  expect(native!.w).toBeCloseTo(frozenBox.width,1); expect(native!.h).toBeCloseTo(frozenBox.height,1);
  await surface.focus(); await page.keyboard.press('h');
  const navBox=(await page.getByTestId('infinite-viewport').boundingBox())!;
  await drag(page,{x:navBox.x+navBox.width*.45,y:navBox.y+navBox.height*.45},{x:70,y:45});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(`rdesign.project.${location.pathname.split('/')[2]}.strokes`)??'[]'))).toEqual([stroke]);
  expect(await page.evaluate(()=>(window as unknown as {__RDESIGN_WORKBENCH__:WorkbenchCanvasAPI}).__RDESIGN_WORKBENCH__.nativeTarget())).toBeNull();
});

test('baseline and verified candidate keep fixed world positions while the camera transforms both boards', async ({ page, request }) => {
  const client=await new BridgeClient(request).connect();
  await client.live();
  let change:ChangeSet|undefined;
  for(let attempt=0;attempt<6&&!change;attempt++){
    const source=await client.state(); const target=source.frame!.nodes.find(node=>node.sourceNodeId==='start-button')!;
    const response=await request.post(`${baseURL}/api/changes/prepare`,{headers:client.headers,data:{projectId:source.project.id,expectedRevision:source.project.revision,operationId:crypto.randomUUID(),nodeId:target.runtimeNodeId,sourceNodeId:'start-button',version:runtimeVersion(source.frame!),intent:'画布对比验收：修改按钮文字并保留行为',properties:{text:'画布对比样例'},scope:'instance'}});
    const result=await response.json();
    if(!response.ok()&&result.error?.code==='STALE_RUNTIME')continue;
    expect(response.ok(),JSON.stringify(result.error)).toBeTruthy(); change=result;
  }
  expect(change,'A fresh source target must eventually permit preparation').toBeTruthy();
  const verifiedResponse=await client.post(`/changes/${change!.id}/verify`,await client.envelope());
  const verified:ChangeSet=await verifiedResponse.json();
  expect(verified.status,JSON.stringify(verified.evidence.map(({name,passed,detail})=>({name,passed,detail})))).toBe('verified');
  await openCanvas(page);
  await page.getByRole('button',{name:'查看变更',exact:true}).click();
  await page.getByRole('button',{name:'对比画面',exact:true}).click();
  const main=page.getByTestId('canvas-board-main'),candidate=page.getByTestId('canvas-board-candidate');
  await expect(candidate).toBeVisible(); await page.getByTestId('canvas-fit').click();
  const positions=async()=>Promise.all([main,candidate].map(board=>board.evaluate(el=>({x:Number(el.getAttribute('data-world-x')),y:Number(el.getAttribute('data-world-y')),w:Number(el.getAttribute('data-world-w')),h:Number(el.getAttribute('data-world-h'))}))));
  const world=await positions();
  expect(world[1].x-world[0].x-world[0].w).toBe(96);
  const before=await camera(page);
  const view=(await page.getByTestId('infinite-viewport').boundingBox())!;
  await page.mouse.move(view.x+view.width*.5,view.y+view.height*.5); await page.mouse.wheel(280,-170);
  await page.keyboard.down('Control'); await page.mouse.wheel(0,-60); await page.keyboard.up('Control');
  expect(await positions()).toEqual(world);
  const after=await camera(page); expect(after.x).not.toBe(before.x); expect(after.zoom).toBeGreaterThan(before.zoom);
  const a=(await main.boundingBox())!,b=(await candidate.boundingBox())!;
  expect((b.x-a.x)/after.zoom).toBeCloseTo(world[1].x-world[0].x,1);
  expect((b.y-a.y)/after.zoom).toBeCloseTo(world[1].y-world[0].y,1);
  expect(a.width/after.zoom).toBeCloseTo(world[0].w,1);
  expect(b.width/after.zoom).toBeCloseTo(world[1].w,1);
});
