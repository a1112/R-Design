import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createWorkerService,sdkWorkerOptions,type WorkerInput,type WorkerRunner} from '../../apps/agent-worker/src/service.js';
import {createWorkerApp} from '../../apps/agent-worker/src/http.js';
import type {Server} from 'node:http';
const dirs:string[]=[];const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{await Promise.all(closers.splice(0).map(fn=>fn()));await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function setup(runner:WorkerRunner,now?:()=>number){const dir=await mkdtemp(path.join(os.tmpdir(),'rdesign-worker-'));dirs.push(dir);const candidateRoot=path.join(dir,'candidates'),candidate=path.join(candidateRoot,'one');await mkdir(path.join(candidate,'src'),{recursive:true});await writeFile(path.join(candidate,'src/App.tsx'),'before');const env={OPENAI_API_KEY:'explicit-worker-api-secret',RDESIGN_AGENT_WORKER_TOKEN:'worker-auth-token-32-characters-long',RDESIGN_AGENT_RUN_COST_CEILING_USD:'0.5'};const service=await createWorkerService({candidateRoot,directory:path.join(dir,'worker'),runner,env,now});closers.push(()=>service.close());const input:WorkerInput={runId:randomUUID(),projectId:'p1',expectedRevision:1,operationId:'op1',executionMode:'external-worker',owner:'desktop',candidateDirectory:candidate,lease:{generation:1,expiresAt:new Date((now?.()??Date.now())+60000).toISOString()},context:{confirmedIntent:{summary:'Change button radius',constraints:['Only selected button'],confirmedAt:new Date().toISOString()},codeRevision:'base1',allowedFiles:['src/App.tsx'],scenarios:['overview']},budget:{maxUsd:1,maxIterations:2}};return {dir,candidate,service,input,env};}
describe('standalone Codex SDK worker',()=>{
  it('forces its explicit API auth, isolated config and candidate-only permission profile',()=>{
    const input={candidateDirectory:'/controlled/candidate'} as WorkerInput;
    const options=sdkWorkerOptions(input,{OPENAI_API_KEY:'worker-key',PATH:'/usr/bin',RDESIGN_AGENT_WORKER_TOKEN:'do-not-inherit'},'/controlled/worker-sdk-state');
    expect(options.codex.apiKey).toBe('worker-key');expect(options.codex.env).toEqual({PATH:'/usr/bin',CODEX_HOME:'/controlled/worker-sdk-state'});
    expect(options.codex.config).toMatchObject({forced_login_method:'api',default_permissions:'rdesign_candidate',approval_policy:'never',permissions:{rdesign_candidate:{network:{enabled:false}}}});
    expect(options.codex.configOverrides?.[0]).toContain('":root"="deny"');expect(options.codex.configOverrides?.[0]).toContain('"/controlled/candidate"="write"');
    expect(options.thread.sandboxMode).toBeUndefined();expect(options.thread.approvalPolicy).toBe('never');expect(options.thread.webSearchMode).toBe('disabled');
  });
  it('persists bounded output, never accepts files itself and rejects operation payload replay',async()=>{
    const runner:WorkerRunner={async run(input){await writeFile(path.join(input.candidateDirectory,'src/App.tsx'),'after');return {summary:'Adjusted radius',threadId:'mock-thread',usage:{input_tokens:10,output_tokens:5}};}};
    const {service,input,candidate}=await setup(runner);const started=await service.start(input);const result=await service.wait(started.id);
    expect(result.status).toBe('completed');expect(result.result).toMatchObject({changedFiles:['src/App.tsx'],iterations:1});expect(result.estimatedCostCeilingUsd).toBe(0.5);expect(await readFile(path.join(candidate,'src/App.tsx'),'utf8')).toBe('after');
    expect((await service.start(input)).id).toBe(started.id);await expect(service.start({...input,operationId:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('blocks out-of-scope edits after SDK execution and refuses out-of-root candidates before execution',async()=>{
    const runner:WorkerRunner={async run(input){await writeFile(path.join(input.candidateDirectory,'extra.ts'),'unexpected');return {summary:'bad scope'};}};
    const {service,input,dir}=await setup(runner);const run=await service.start(input);expect((await service.wait(run.id)).status).toBe('failed');expect(service.get(run.id).logs.join(' ')).toContain('outside its allowed scope');
    await expect(service.start({...input,runId:randomUUID(),candidateDirectory:dir})).rejects.toMatchObject({code:'CANDIDATE_PATH'});
  });
  it('explicit cancellation and expired lease prevent completion and stale renewal',async()=>{
    let stamp=Date.now();const runner:WorkerRunner={async run(_input,signal){await new Promise<void>((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});return {summary:'never'};}};
    const {service,input}=await setup(runner,()=>stamp);const run=await service.start(input);stamp+=61000;
    await expect(service.heartbeat(run.id,{generation:1,expiresAt:new Date(stamp+60000).toISOString()})).rejects.toMatchObject({code:'LEASE_CONFLICT'});
    await service.cancel(run.id,1);expect((await service.wait(run.id)).status).toBe('cancelled');expect(service.get(run.id).lease.generation).toBe(2);
    await expect(service.cancel(run.id,1)).rejects.toMatchObject({code:'LEASE_CONFLICT'});
  });
  it('requires token auth and denies browser origins on the actual loopback HTTP API',async()=>{
    const {service,env}=await setup({async run(){return {summary:'mock'};}});let server:Server;
    const probe=await new Promise<Server>(resolve=>{const instance=createWorkerApp(service,env.RDESIGN_AGENT_WORKER_TOKEN,0).listen(0,'127.0.0.1',()=>resolve(instance));});server=probe;closers.unshift(()=>new Promise(resolve=>server.close(()=>resolve())));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No bound HTTP address');const base=`http://127.0.0.1:${address.port}`;
    const auth={Authorization:'Bearer '+env.RDESIGN_AGENT_WORKER_TOKEN};
    expect((await fetch(base+'/health',{})).status).toBe(401);
    expect((await fetch(base+'/health',{headers:{...auth,Origin:'http://malicious.example'}})).status).toBe(403);
    const response=await fetch(base+'/health',{headers:auth});expect(response.status).toBe(200);const json=await response.json();expect(json.budgetPolicy).toBe('estimated-preflight-ceiling');expect(JSON.stringify(json)).not.toContain(env.OPENAI_API_KEY);
  });
});
