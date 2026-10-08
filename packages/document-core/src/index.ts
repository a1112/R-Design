import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Project, ChangeSet, WriteEnvelope, RuntimeFrame } from '../../protocol/src/index.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 409, public retryable = false) { super(message); }
}
interface Operation { fingerprint: string; status?:'pending'|'completed'|'failed'; result?: unknown; revision: number; error?:{code:string;message:string;status:number;retryable:boolean} }
interface Stored { schemaVersion: 1; project: Project; changes: ChangeSet[]; operations: Record<string, Operation> }
export function validateEnvelope(envelope: WriteEnvelope, project: Project) {
  if (!envelope || envelope.projectId !== project.id) throw new DomainError('PROJECT_MISMATCH', '项目身份不匹配', 400);
  if (!Number.isSafeInteger(envelope.expectedRevision) || envelope.expectedRevision !== project.revision) throw new DomainError('REVISION_CONFLICT', `项目已更新，请刷新至版本 ${project.revision}`);
  if (typeof envelope.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(envelope.operationId)) throw new DomainError('INVALID_OPERATION_ID', 'operationId 必须是 8–128 位字母、数字、短横线或下划线', 400);
}
export function createProject(codeRevision: string): Project {
  return { id: `project_${randomUUID()}`, name: 'Northstar · 设备工作台', revision: 1, codeRevision,
    annotations: [], snapshots: [], assets: [], designFrames: [], scenarios: [
      { id: 'overview-desktop', name: '设备总览 · 桌面', route: '/', viewport: {width: 1200, height: 820}, steps: [], readySelector: '[data-rdesign-id="start-button"]', dependencies: ['src/main.tsx'], status: 'unverified' },
      { id: 'overview-narrow', name: '设备总览 · 窄屏', route: '/', viewport: {width: 390, height: 844}, steps: [], readySelector: '[data-rdesign-id="start-button"]', dependencies: ['src/main.tsx'], status: 'unverified' },
      { id: 'settings', name: '设置弹窗', route: '/', viewport: {width: 1200, height: 820}, steps: [{action:'click',target:'settings-button'}], readySelector: '[data-rdesign-id="settings-modal"]', dependencies: ['src/main.tsx'], status: 'unverified' },
    ] };
}
export class DocumentStore {
  private state!: Stored;
  private queue: Promise<unknown> = Promise.resolve();private dirty=false;
  constructor(public directory: string) {}
  get project() { return this.state.project; }
  get changes() { return this.state.changes; }
  get health(){return {writable:!this.dirty,pendingOperations:Object.entries(this.state.operations).filter(([,op])=>op.status==='pending').map(([id])=>id)};}
  async load(codeRevision: string) {
    await mkdir(this.directory, {recursive: true});
    try { this.state = JSON.parse(await readFile(path.join(this.directory, 'project.json'),'utf8')); if (this.state.schemaVersion !== 1) throw new Error('不支持的项目格式'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.state = {schemaVersion:1,project:createProject(codeRevision),changes:[],operations:{}}; await this.save(); }
    if (this.project.codeRevision !== codeRevision) { this.project.codeRevision = codeRevision; this.project.scenarios.forEach(s => s.status = 'stale'); await this.save(); }
    for (const change of this.changes) if (change.status === 'verifying') { change.status = 'failed'; change.error = '验证被服务重启中断，可重新验证'; }
    return this;
  }
  async save() {
    const file = path.join(this.directory,'project.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state,null,2)); await rename(temporary,file);this.dirty=false;
  }
  async blob(data: Buffer, extension = 'png') {
    const hash = digest(data); const directory = path.join(this.directory,'blobs'); await mkdir(directory,{recursive:true}); await writeFile(path.join(directory,`${hash}.${extension}`),data); return hash;
  }
  async snapshot(frame: RuntimeFrame) {
    if (frame.image.startsWith('data:image/png;base64,')) await this.blob(Buffer.from(frame.image.split(',')[1],'base64'));
    const snapshot = {...frame,id:`snapshot_${randomUUID()}`,kind:'snapshot' as const,status:'frozen' as const}; this.project.snapshots.push(snapshot); return snapshot;
  }
  async write<T>(envelope: WriteEnvelope, fingerprint: string, mutation: () => Promise<T> | T): Promise<T> {
    const persist=async()=>{try{await this.save();}catch(error){this.dirty=true;throw new DomainError('STORE_SAVE_FAILED','操作收据暂时无法持久化；已执行操作不会自动重放，请恢复存储后用相同 operationId 重试',503,true);}};
    const run = this.queue.then(async () => {
      if(this.dirty)await persist();
      const operation = this.state.operations[envelope?.operationId];
      if (operation) {if(operation.fingerprint!==fingerprint)throw new DomainError('OPERATION_COLLISION','相同 operationId 对应不同操作',409);if(operation.status==='pending')throw new DomainError('OPERATION_OUTCOME_UNKNOWN','服务在该操作确认前中断；不能自动重复产生副作用，请先核对运行结果',409,false);if(operation.status==='failed'&&operation.error)throw new DomainError(operation.error.code,operation.error.message,operation.error.status,operation.error.retryable);return operation.result as T;}
      validateEnvelope(envelope,this.project);
      const backup=JSON.stringify(this.state);
      // Persist a durable fence before any browser, file or provider side effect.
      this.state.operations[envelope.operationId]={fingerprint,status:'pending',revision:this.project.revision};
      try{await this.save();}catch(error){this.state=JSON.parse(backup);this.dirty=false;throw new DomainError('STORE_SAVE_FAILED','无法保存操作开始记录，尚未执行该操作',503,true);}
      let result:T;
      try{result=await mutation();}
      catch(error){this.state=JSON.parse(backup);const failure=error as DomainError;this.state.operations[envelope.operationId]={fingerprint,status:'failed',revision:this.project.revision,error:{code:failure.code??'MUTATION_FAILED',message:failure.message,status:failure.status??400,retryable:failure.retryable??false}};await persist();throw error;}
      this.project.revision+=1;this.state.operations[envelope.operationId]={fingerprint,status:'completed',result,revision:this.project.revision};
      // A receipt save failure retains completed state and fences future writes until it flushes.
      await persist();return result;
    });
    this.queue=run.catch(()=>{});return run;
  }
  export() { return {schemaVersion:1, project:this.project,changes:this.changes}; }
  import(document: unknown) {
    if (!document || typeof document !== 'object' || (document as any).schemaVersion !== 1) throw new DomainError('IMPORT_SCHEMA','不支持的文档格式',400);
    const incoming = (document as any).project as Project;
    if (!incoming || !Array.isArray(incoming.annotations) || !Array.isArray(incoming.snapshots) || !Array.isArray(incoming.assets) || !Array.isArray(incoming.scenarios) || !Array.isArray(incoming.designFrames)) throw new DomainError('IMPORT_SCHEMA','文档缺少必填集合',400);
    for (const asset of incoming.assets) if (!/^data:image\/(png|jpeg|webp);base64,/.test(asset.url)) throw new DomainError('IMPORT_ASSET','仅允许内嵌静态图像资产',400);
    for (const frame of incoming.snapshots) if (!/^data:image\/png;base64,/.test(frame.image)) throw new DomainError('IMPORT_SNAPSHOT','无效截图引用',400);
    for (const scenario of incoming.scenarios) { if (!scenario.route.startsWith('/') || scenario.route.startsWith('//') || scenario.route.includes('\\')) throw new DomainError('IMPORT_PATH','场景路由越界',400); for (const file of scenario.dependencies) if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new DomainError('IMPORT_PATH','场景依赖路径越界',400); }
    // Imported evidence does not authorize changing source; keep the current code version and identity.
    this.state.project = {...incoming,id:this.project.id,revision:this.project.revision,codeRevision:this.project.codeRevision};
    this.state.changes = [];
    return this.project;
  }
}
