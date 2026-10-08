import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet, ChangeRequest, FilePatch } from '../../protocol/src/index.js';
import { DocumentStore, DomainError, digest } from '../../document-core/src/index.js';
import { transform, indexSources, codeHash, safePath, trackedFiles, type Mutation } from '../../source-binding/src/index.js';
import { BrowserRuntime } from '../../../apps/bridge/src/runtime.js';
import { verifyScenarios } from '../../scenario-runner/src/index.js';
interface Metadata {sourceNodeId:string;file:string;mutations:Mutation[];candidateHash:string;candidateFiles:Record<string,string>;kind?:'agent'|'agent-pending';owner?:string;executor?:'host'|'external-worker'}
export class ChangeEngine {
  constructor(public store:DocumentStore, public runtime:BrowserRuntime, public repoRoot:string) {}
  candidateRoot(id:string) { if(!/^change_[a-f0-9-]{36}$/.test(id))throw new DomainError('INVALID_CHANGE_ID','无效变更身份',400);return path.join(this.store.directory,'candidates',id); }
  metadataFile(id:string){this.candidateRoot(id);return path.join(this.store.directory,'change-metadata',`${id}.json`);}
  async metadata(change:ChangeSet):Promise<Metadata> {return JSON.parse(await readFile(this.metadataFile(change.id),'utf8'));}
  find(id:string) {const change=this.store.changes.find(c=>c.id===id);if(!change)throw new DomainError('CHANGE_NOT_FOUND','变更不存在',404);return change;}
  async prepare(request:ChangeRequest,owner='desktop') {
    const agentMode=(request as ChangeRequest&{executionMode?:string}).executionMode==='agent';
    if(!request.intent?.trim()||request.intent.length>2000||!request.properties||(!agentMode&&Object.keys(request.properties).length<1)||Object.keys(request.properties).length>20)throw new DomainError('INVALID_INTENT','请明确变更意图与受控属性',400);
    if(request.scope!=='instance')throw new DomainError('SCOPE_UNSUPPORTED','首版受控编辑仅支持唯一的当前实例，共享样式请交由代码任务',400);
    if(agentMode&&!request.annotationId)throw new DomainError('INTENT_UNCONFIRMED','复杂代码任务需要已确认的批注',400);
    if(request.annotationId) {const annotation=this.store.project.annotations.find(a=>a.id===request.annotationId);if(!annotation?.intent?.confirmedAt)throw new DomainError('INTENT_UNCONFIRMED','批注意图尚未确认',400);}
    const {entry}=await this.runtime.resolve(request.nodeId,request.sourceNodeId,request.version);const {after,mutations}=transform(entry,request.properties);if(!agentMode&&after===entry.source)throw new DomainError('EMPTY_CHANGE','属性没有改变',400);
    const patch:FilePatch={file:entry.binding.file,before:entry.source,after,beforeHash:digest(entry.source),afterHash:digest(after)};const change:ChangeSet={id:`change_${randomUUID()}`,projectId:this.store.project.id,operationId:request.operationId,expectedRevision:request.expectedRevision,status:'prepared',intent:request.intent,createdAt:new Date().toISOString(),baseCodeRevision:request.version.codeRevision,diffHash:digest(JSON.stringify([patch])),patches:[patch],evidence:[],annotationId:request.annotationId};
    const candidate=this.candidateRoot(change.id);await mkdir(candidate,{recursive:true});await cp(this.runtime.root,candidate,{recursive:true,filter:source=>!source.split(path.sep).some(segment=>['node_modules','.git','.rdesign','dist'].includes(segment))});await writeFile(path.join(candidate,patch.file),after);
    await mkdir(path.join(this.store.directory,'change-metadata'),{recursive:true});await writeFile(this.metadataFile(change.id),JSON.stringify({sourceNodeId:request.sourceNodeId,file:patch.file,mutations,kind:agentMode?'agent-pending':undefined,owner,executor:(request as ChangeRequest&{executor?:string}).executor==='host'?'host':'external-worker',candidateHash:await codeHash(candidate),candidateFiles:Object.fromEntries(await Promise.all((await trackedFiles(candidate)).map(async file=>[file,digest(await readFile(await safePath(candidate,file)))])))}));
    const baseline=path.join(this.store.directory,'baselines',change.id);await mkdir(baseline,{recursive:true});await writeFile(path.join(baseline,'source.json'),JSON.stringify({codeRevision:change.baseCodeRevision,files:change.patches.map(p=>({file:p.file,hash:p.beforeHash,content:p.before}))},null,2));
    this.store.changes.push(change);if(change.annotationId){const a=this.store.project.annotations.find(a=>a.id===change.annotationId)!;a.status='task-created';}return change;
  }
  async candidateUntouched(change:ChangeSet) {const root=this.candidateRoot(change.id);const meta=await this.metadata(change);if(await codeHash(root)!==meta.candidateHash)throw new DomainError('CANDIDATE_CHANGED','候选文件已变化，需要重新准备及确认差异');for(const patch of change.patches)if(digest(await readFile(await safePath(root,patch.file)))!==patch.afterHash)throw new DomainError('CANDIDATE_CHANGED','候选补丁哈希已变化');return meta;}
  async finalizeHost(id:string,owner:string) {const change=this.find(id);const meta=await this.metadata(change);if(meta.executor!=='host'||meta.owner!==owner||meta.kind!=='agent-pending')throw new DomainError('EXECUTOR_CONFLICT','只允许拥有该候选的宿主执行者冻结变更');return this.finalizeAgent(id);}
  async finalizeAgent(id:string) {
    const change=this.find(id);if(!['prepared','failed'].includes(change.status))throw new DomainError('CHANGE_STATE','候选已验收或接受，不能再修改');
    const root=this.candidateRoot(id);const meta=await this.metadata(change);const allowed=new Set(change.patches.map(p=>p.file));const files=await trackedFiles(root);
    if(files.some(file=>!meta.candidateFiles[file])||Object.keys(meta.candidateFiles).some(file=>!files.includes(file)))throw new DomainError('AGENT_SCOPE','Worker 增删了授权范围之外的文件');
    for(const file of files)if(!allowed.has(file)&&digest(await readFile(await safePath(root,file)))!==meta.candidateFiles[file])throw new DomainError('AGENT_SCOPE',`Worker 修改了禁止文件 ${file}`);
    const patches:FilePatch[]=[];
    for(const previous of change.patches) {const after=await readFile(await safePath(root,previous.file),'utf8');if(after!==previous.before)patches.push({...previous,after,afterHash:digest(after)});}
    if(!patches.length)throw new DomainError('EMPTY_CHANGE','Worker 未产生源码变更');
    change.patches=patches;change.diffHash=digest(JSON.stringify(patches));change.status='prepared';change.evidence=[];delete change.candidateFrame;delete change.error;
    meta.candidateHash=await codeHash(root);meta.kind='agent';meta.mutations=[];meta.candidateFiles=Object.fromEntries(await Promise.all(files.map(async file=>[file,digest(await readFile(await safePath(root,file)))])));
    await writeFile(this.metadataFile(id),JSON.stringify(meta));return change;
  }
  async verify(id:string) {
    const change=this.find(id);if(!['prepared','failed','verified'].includes(change.status))throw new DomainError('CHANGE_STATE','当前变更不能验证');const meta=await this.candidateUntouched(change);if(meta.kind==='agent-pending')throw new DomainError('AGENT_PENDING','代码任务尚未完成和冻结，不能验证空候选');change.status='verifying';change.evidence=[];await this.store.save();const candidate=new BrowserRuntime(this.candidateRoot(id),this.repoRoot,'candidate',0,this.store.directory);
    try {await candidate.build();change.evidence.push({name:'生产构建',passed:true,detail:'独立候选目录 Vite 生产构建通过'});await candidate.start();change.evidence.push(...await verifyScenarios(candidate,this.store.project.scenarios));
      const target=candidate.page.locator(`[data-rdesign-id="${meta.sourceNodeId}"]`);const actual=await target.evaluate((element,mutations)=>{const node=element as HTMLElement;const failures:string[]=[];for(const mutation of mutations){if(mutation.property==='text'){if(node.textContent?.trim()!==String(mutation.after))failures.push(`文字未生效: ${node.textContent}`);}else{const tester=document.createElement('div');(tester.style as any)[mutation.property]=mutation.after===null?'':String(mutation.after)+(typeof mutation.after==='number'&&!['fontWeight','lineHeight'].includes(mutation.property)?'px':'');const expected=(tester.style as any)[mutation.property];const current=(node.style as any)[mutation.property];if(!expected||current!==expected)failures.push(`${mutation.property}: 期望 ${expected}，实际 ${current}`);}}return failures;},meta.mutations);
      change.evidence.push({name:'目标属性回读',passed:actual.length===0,detail:actual.length?actual.join('\n'):meta.kind==='agent'?'目标实例存在，复杂意图须结合差异和场景证据人工审查':'指定实例的文字与内联属性均已实际生效'});change.candidateFrame={...await candidate.capture('candidate'),status:'frozen'};await this.store.blob(Buffer.from(change.candidateFrame.image.split(',')[1],'base64'));change.status=change.evidence.every(e=>e.passed)?'verified':'failed';change.error=change.status==='failed'?'候选验证未全部通过':undefined;
    }catch(error){change.status='failed';change.error=(error as Error).message;change.evidence.push({name:'候选执行',passed:false,detail:change.error});}finally{await candidate.close();}return change;
  }
  async apply(id:string,diffHash:string) {
    const change=this.find(id);if(change.status!=='verified'||!change.evidence.length||!change.evidence.every(e=>e.passed))throw new DomainError('UNVERIFIED_CHANGE','只有全部验证通过的变更可以接受');if(diffHash!==change.diffHash||digest(JSON.stringify(change.patches))!==diffHash)throw new DomainError('APPROVAL_HASH','审批哈希与当前差异不匹配');await this.candidateUntouched(change);if(await codeHash(this.runtime.root)!==change.baseCodeRevision)throw new DomainError('SOURCE_CONFLICT','工作区基准已变化，必须重新准备并验证候选');
    for(const patch of change.patches)if(digest(await readFile(await safePath(this.runtime.root,patch.file)))!==patch.beforeHash)throw new DomainError('SOURCE_CONFLICT','接受目标文件被外部编辑，未覆盖现有修改');
    for(const patch of change.patches)await this.atomicWrite(await safePath(this.runtime.root,patch.file),patch.after);
    this.store.project.codeRevision=await codeHash(this.runtime.root);this.store.project.scenarios.forEach(s=>s.status='stale');change.status='accepted';change.acceptedAt=new Date().toISOString();if(change.annotationId){const annotation=this.store.project.annotations.find(a=>a.id===change.annotationId);if(annotation)annotation.status='resolved';}return change;
  }
  async revert(id:string) {
    const change=this.find(id);if(change.status!=='accepted')throw new DomainError('CHANGE_STATE','只能回退已接受的变更');const meta=await this.metadata(change);if(meta.kind==='agent'){const pending:Array<{file:string;content:string}>=[];for(const patch of change.patches){const file=await safePath(this.runtime.root,patch.file);const current=await readFile(file,'utf8');pending.push({file,content:reversePatch(patch,current)});}for(const item of pending)await this.atomicWrite(item.file,item.content);change.status='reverted';this.store.project.codeRevision=await codeHash(this.runtime.root);this.store.project.scenarios.forEach(s=>s.status='stale');return change;}const entries=(await indexSources(this.runtime.root)).get(meta.sourceNodeId);if(entries?.length!==1)throw new DomainError('REVERT_CONFLICT','当前目标源码映射不唯一');const requested=Object.fromEntries(meta.mutations.map(m=>[m.property,m.before]));const expected=Object.fromEntries(meta.mutations.map(m=>[m.property,m.after]));const {after}=transform(entries[0],requested,expected);await this.atomicWrite(await safePath(this.runtime.root,meta.file),after);change.status='reverted';this.store.project.codeRevision=await codeHash(this.runtime.root);this.store.project.scenarios.forEach(s=>s.status='stale');return change;
  }
  discard(id:string) {const change=this.find(id);if(['accepted','reverted'].includes(change.status))throw new DomainError('CHANGE_STATE','已接受的变更须通过回退处理');change.status='discarded';return change;}
  private async atomicWrite(file:string,content:string) {const temporary=`${file}.${randomUUID()}.tmp`;await writeFile(temporary,content);await rename(temporary,file);}
}

/** Reverse a unique accepted fragment; concurrent edits inside the fragment fail closed. */
export function reversePatch(patch:FilePatch,current:string) {
  let start=0;while(start<patch.before.length&&start<patch.after.length&&patch.before[start]===patch.after[start])start++;
  let endBefore=patch.before.length,endAfter=patch.after.length;while(endBefore>start&&endAfter>start&&patch.before[endBefore-1]===patch.after[endAfter-1]){endBefore--;endAfter--;}
  const anchorStart=Math.max(0,start-100),anchorEnd=Math.min(patch.after.length,endAfter+100);const needle=patch.after.slice(anchorStart,anchorEnd);const replacement=patch.before.slice(anchorStart,start)+patch.before.slice(start,endBefore)+patch.after.slice(endAfter,anchorEnd);
  const position=current.indexOf(needle);if(!needle||position<0||current.indexOf(needle,position+1)>=0)throw new DomainError('REVERT_CONFLICT','已接受的源码片段被后续修改或定位不唯一');return current.slice(0,position)+replacement+current.slice(position+needle.length);
}
