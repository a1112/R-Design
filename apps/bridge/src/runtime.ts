import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer, build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileBoundary } from './vite-security.js';
import { runtimeDependencies } from './runtime-dependencies.js';
import { rdesignSourceIds } from '../../../packages/runtime-web/src/vite.js';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer as createSocketServer } from 'node:net';
import type { RuntimeFrame, RuntimeTree, RuntimeVersion, ObservedNode } from '../../../packages/protocol/src/index.js';
import { sameTargetVersion } from '../../../packages/protocol/src/index.js';
import { indexSources, codeHash } from '../../../packages/source-binding/src/index.js';
import { DomainError, digest } from '../../../packages/document-core/src/index.js';
async function availablePreviewPort(): Promise<number> {
  const server = createSocketServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else if (!address || typeof address === 'string') reject(new Error('Preview port unavailable'));
        else resolve(address.port);
      });
    });
  });
}
export class BrowserRuntime {
  browser!: Browser; page!: Page; server!: ViteDevServer;
  private index = new Map<string,Awaited<ReturnType<typeof indexSources>> extends Map<string,infer V>? V:never>();
  private revision = ''; private queue:Promise<unknown>=Promise.resolve();
  lastFrame:RuntimeFrame|null=null;status:RuntimeFrame['status']='connecting';private needsReload=false;
  constructor(public root:string, public repoRoot:string, public kind:'live'|'candidate'='live', public port=0,public privateDirectory?:string) { this.root=realpathSync(root); }
  config() { return {configFile:false as const,cacheDir:path.join(this.repoRoot,`node_modules/.vite/runtime-${digest(this.root).slice(0,16)}-${this.port}`),publicDir:false as const,root:this.root,define:{'import.meta.env.VITE_RDESIGN_RUNTIME':'"true"'},plugins:[fileBoundary({root:this.root,allow:[this.root,path.join(this.repoRoot,'packages/runtime-web'),path.join(this.repoRoot,'packages/protocol'),path.join(this.repoRoot,'node_modules')],privateRoots:this.privateDirectory&&(path.resolve(this.privateDirectory)===this.root||path.resolve(this.privateDirectory).startsWith(this.root+path.sep))?[this.privateDirectory]:[]}),runtimeDependencies(this.repoRoot),rdesignSourceIds({root:this.root}),react()],resolve:{alias:{'@rdesign/runtime-web':path.join(this.repoRoot,'packages/runtime-web/src/index.ts'),'@rdesign/protocol':path.join(this.repoRoot,'packages/protocol/src/index.ts'),'react':path.join(this.repoRoot,'node_modules/react'),'react-dom':path.join(this.repoRoot,'node_modules/react-dom')}},server:{host:'127.0.0.1',port:this.port,strictPort:this.port>0,hmr:false,ws:false as const,fs:{strict:true,allow:[this.root,path.join(this.repoRoot,'packages/runtime-web'),path.join(this.repoRoot,'packages/protocol'),path.join(this.repoRoot,'node_modules')],deny:['**/.git/**','**/.env','**/.env.*','**/*.{crt,pem,key}','**/change-meta.json',path.join(this.root,'**/.rdesign/**'),...(this.privateDirectory&&(path.resolve(this.privateDirectory)===this.root||path.resolve(this.privateDirectory).startsWith(this.root+path.sep))?[path.join(path.resolve(this.privateDirectory),'**')]:[])]}},logLevel:'error' as const}; }
  async start() {
    if (this.port === 0) this.port = await availablePreviewPort();
    this.server=await createServer(this.config());await this.server.listen();
    try {this.browser=await chromium.launch({headless:true, ...(process.env.RDESIGN_BROWSER?{executablePath:process.env.RDESIGN_BROWSER}:{})});}
    catch(error) { if(!existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))throw error;this.browser=await chromium.launch({headless:true,channel:'chrome'}); }
    this.page=await this.browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:1});await this.page.goto(this.url(),{waitUntil:'networkidle'});await this.page.waitForFunction(()=>Boolean((window as any).__RDESIGN__),undefined,{timeout:15000});await this.refreshSources();this.status='live';return this;
  }
  url() {const address=this.server.httpServer?.address();if(!address||typeof address==='string')throw new Error('Preview server unavailable');return `http://127.0.0.1:${address.port}`;}
  async refreshSources() {
    const next=await codeHash(this.root);
    try {if((this.needsReload||this.revision&&this.revision!==next)&&this.page){this.status='resyncing';this.needsReload=true;this.server.moduleGraph.invalidateAll();await this.page.reload({waitUntil:'networkidle',timeout:8000});await this.page.waitForFunction(()=>Boolean((window as any).__RDESIGN__),undefined,{timeout:5000});}
      this.index=await indexSources(this.root);this.revision=next;this.needsReload=false;this.status='live';
    }catch(error){this.needsReload=true;this.status='build-failed';throw new DomainError('BUILD_FAILED',`源码更新未能产生可用运行实例：${(error as Error).message}`,503,true);}
  }
  async build() {await build({...this.config(),build:{outDir:path.join(this.root,'dist'),emptyOutDir:true}});}
  async close() {await this.browser?.close();await this.server?.close();}
  async serial<T>(operation:()=>Promise<T>) {const promise=this.queue.then(operation);this.queue=promise.catch(()=>{});return promise;}
  private async sample() {return this.page.evaluate(()=>({tree:(window as any).__RDESIGN__.snapshot() as RuntimeTree,health:(window as any).__RDESIGN__.health()}));}
  private version(tree:RuntimeTree,health:any):RuntimeVersion {return {runtimeSessionId:health.runtimeSessionId??'runtime_'+randomUUID(),epoch:health.epoch??1,surfaceId:health.surfaceId??'main',codeRevision:this.revision,treeRevision:tree.treeRevision,geometryRevision:tree.geometryRevision,viewportRevision:tree.viewportRevision};}
  async currentVersion() {if(this.status!=='live')throw new DomainError('RUNTIME_UNAVAILABLE','运行实例正在重同步或构建失败',503,true);const {tree,health}=await this.sample();return {...this.version(tree,health),codeRevision:await codeHash(this.root)};}
  async checkVersion(version:RuntimeVersion) {const current=await this.currentVersion();if(!version||!sameTargetVersion(current,version))throw new DomainError('STALE_RUNTIME','运行实例、源码、结构或几何版本已变化，请重新选择');}
  async capture(kind:'live'|'snapshot'|'candidate'=this.kind):Promise<RuntimeFrame> {return this.serial(async()=>{
    await this.refreshSources(); let sampled=await this.sample();let pixels:Buffer=Buffer.alloc(0);let stable=false;
    for(let attempt=0;attempt<5;attempt++) {
      sampled=await this.sample();pixels=await this.page.screenshot({type:'png',animations:'allow',caret:'initial',mask:[this.page.locator('[data-rdesign-private], input[type="password"]')],maskColor:'#242938'});const next=await this.sample();
      if(sameTargetVersion(this.version(sampled.tree,sampled.health),this.version(next.tree,next.health))) {stable=true;break;}
      await this.page.waitForTimeout(90);
    }
    if(!stable)throw new DomainError('FRAME_UNSTABLE','画面仍在变化，等待下一帧',409,true);
    const nodes=sampled.tree.nodes.map(node=>{const entries=node.sourceNodeId?this.index.get(node.sourceNodeId):undefined; const count=sampled.tree.nodes.filter(n=>n.sourceNodeId&&n.sourceNodeId===node.sourceNodeId).length;return {...node,binding:entries?.length===1?{...entries[0].binding,reliability:count>1?'ambiguous' as const:entries[0].binding.reliability,scope:count>1?'shared' as const:'instance' as const}:undefined};});
    const viewport=this.page.viewportSize()!;const frame:RuntimeFrame={...this.version(sampled.tree,sampled.health),id:`frame_${randomUUID()}`,kind,timestamp:new Date().toISOString(),width:viewport.width,height:viewport.height,image:`data:image/png;base64,${pixels.toString('base64')}`,nodes,status:kind==='snapshot'?'frozen':'live'};this.lastFrame=frame;return frame;
  });}
  async viewport(width:number,height:number) {if(!Number.isInteger(width)||!Number.isInteger(height)||width<320||width>2560||height<400||height>1800)throw new DomainError('INVALID_VIEWPORT','视口范围为 320–2560 × 400–1800',400);await this.serial(async()=>{await this.page.setViewportSize({width,height});await this.page.evaluate(()=>document.fonts.ready);});return this.capture();}
  async input(input:{version:RuntimeVersion;action:string;x?:number;y?:number;key?:string;deltaY?:number}) {return this.serial(async()=>{
    await this.checkVersion(input.version);const viewport=this.page.viewportSize()!;
    if(input.action==='click'){if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x!<0||input.y!<0||input.x!>viewport.width||input.y!>viewport.height)throw new DomainError('INVALID_COORDINATES','点击坐标超出源视口',400);const hit=await this.page.evaluate(({x,y})=>(window as any).__RDESIGN__.hitTest(x,y),{x:input.x,y:input.y});if(!hit)throw new DomainError('HIT_MISSING','当前画面没有可确认的目标');await this.page.mouse.click(input.x!,input.y!);}
    else if(input.action==='key'){const key=input.key;if(typeof key!=='string'||!key||key.length>1000)throw new DomainError('INVALID_KEY','键盘输入无效',400);if(/^(Enter|Escape|Tab|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Home|End|Control\+A|Meta\+A|Shift\+Tab)$/.test(key))await this.page.keyboard.press(key);else await this.page.keyboard.insertText(key);}
    else if(input.action==='scroll'){if(!Number.isFinite(input.deltaY)||Math.abs(input.deltaY!)>3000)throw new DomainError('INVALID_SCROLL','滚动超出单次范围',400);await this.page.mouse.wheel(0,input.deltaY!);}
    else throw new DomainError('INVALID_ACTION','未知输入动作',400);
  });}
  async resolve(nodeId:string,sourceNodeId:string,version:RuntimeVersion) {await this.checkVersion(version);const frame=this.lastFrame;const node=frame?.nodes.find(n=>n.runtimeNodeId===nodeId);if(!node||node.sourceNodeId!==sourceNodeId||node.binding?.reliability!=='exact')throw new DomainError('UNMAPPED_TARGET','目标不存在或源码映射不唯一');await this.refreshSources();const entries=this.index.get(sourceNodeId);if(entries?.length!==1||entries[0].binding.fileHash!==node.binding.fileHash)throw new DomainError('SOURCE_CONFLICT','目标源码已变化');return {node,entry:entries[0]};}
}
