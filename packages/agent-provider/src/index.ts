import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProviderError } from '../../asset-provider/src/index.js';

export interface ConfirmedDesignContext {
  confirmedIntent: { summary: string; constraints: string[]; confirmedAt: string };
  codeRevision: string; allowedFiles: string[]; scenarios: string[]; selection?: unknown;
}
export interface AgentStartRequest {
  projectId: string; expectedRevision: number; operationId: string; executionMode: 'external-worker'; owner: string;
  context: ConfirmedDesignContext; budget: { maxUsd: number; maxIterations: number }; candidateDirectory: string;
}
export interface AgentRun {
  id: string; projectId: string; operationId: string; requestHash: string;
  executionMode: 'external-worker'; owner: string; status: 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  lease: { generation: number; expiresAt: string }; createdAt: string; updatedAt: string;
  codeRevision: string; candidateDirectory: string; budget: AgentStartRequest['budget']; workerRunId?: string;
  logs: string[]; result?: unknown;
}
export function createAgentProvider(options: { directory: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch }) {
  const env = options.env ?? process.env;
  const workerURL = env.RDESIGN_AGENT_WORKER_URL; const workerToken = env.RDESIGN_AGENT_WORKER_TOKEN;
  const maxBudget = Number(env.RDESIGN_AGENT_MAX_BUDGET_USD ?? '2');
  const journal = path.join(options.directory, 'provider-agent');
  const status = () => workerURL && workerToken ? 'configured:external-worker' : 'unavailable: configure an independently authorized RDESIGN_AGENT_WORKER_URL and RDESIGN_AGENT_WORKER_TOKEN';
  const file = (id: string) => { if (!/^[0-9a-f-]{36}$/.test(id)) throw new ProviderError('INVALID_RUN_ID', 'Invalid run ID.'); return path.join(journal, id + '.json'); };
  const save = async (run: AgentRun) => { await mkdir(journal, { recursive: true, mode: 0o700 }); await writeFile(file(run.id) + '.tmp', JSON.stringify(run), { mode: 0o600 }); await rename(file(run.id) + '.tmp', file(run.id)); };
  const load = async (id: string): Promise<AgentRun> => { try { return JSON.parse(await readFile(file(id), 'utf8')); } catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProviderError('RUN_NOT_FOUND', 'Agent run was not found.'); throw error; } };
  const request = async (route: string, body?: unknown) => {
    if (!workerURL || !workerToken) throw new ProviderError('PROVIDER_UNAVAILABLE', status());
    const url = new URL(workerURL);
    if (url.username || url.password) throw new ProviderError('INVALID_WORKER_URL', 'Use the configured worker token instead of URL credentials.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new ProviderError('INSECURE_WORKER_URL', 'External workers require HTTPS; HTTP is restricted to loopback.');
    const response = await (options.fetch ?? fetch)(new URL(route, url), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new ProviderError('WORKER_REJECTED', `Worker returned HTTP ${response.status}.`, response.status >= 500);
    return response.json() as Promise<{ id?: string; status?: AgentRun['status']; logs?: string[]; result?: unknown }>;
  };
  const perProject = new Map<string, Promise<AgentRun>>();
  const startOnce = async (input: AgentStartRequest): Promise<AgentRun> => {
    if (!workerURL || !workerToken) throw new ProviderError('PROVIDER_UNAVAILABLE', status());
    if (input.executionMode !== 'external-worker') throw new ProviderError('EXECUTOR_CONFLICT', 'Host-driven tasks must use MCP tools directly, without starting another executor.');
    if (!input.projectId || !input.operationId || !Number.isInteger(input.expectedRevision) || !path.isAbsolute(input.candidateDirectory ?? '')) throw new ProviderError('INVALID_INPUT', 'A valid write envelope and server-controlled absolute candidate directory are required.');
    if (!input.context?.confirmedIntent?.confirmedAt || !input.context.confirmedIntent.summary.trim() || !input.owner || !input.context.codeRevision) throw new ProviderError('UNCONFIRMED_INTENT', 'Confirmed intent, explicit owner and base revision are required.');
    if (!Array.isArray(input.context.allowedFiles) || !input.context.allowedFiles.length || input.context.allowedFiles.some(value => path.isAbsolute(value) || value.split(/[\\/]/).includes('..'))) throw new ProviderError('INVALID_FILE_SCOPE', 'Allowed file paths must be relative and stay inside the candidate.');
    if (!Number.isFinite(input.budget?.maxUsd) || input.budget.maxUsd <= 0 || input.budget.maxUsd > maxBudget || !Number.isInteger(input.budget.maxIterations) || input.budget.maxIterations < 1 || input.budget.maxIterations > 3) throw new ProviderError('BUDGET_EXCEEDED', 'Run requires bounded spend and one to three iterations.');
    const {expectedRevision: _expectedRevision, ...logicalRequest} = input;
    const requestHash = createHash('sha256').update(JSON.stringify(logicalRequest)).digest('hex');
    const id = randomUUID();
    await mkdir(journal, { recursive: true, mode: 0o700 });
    const { readdir } = await import('node:fs/promises');
    for (const name of await readdir(journal)) {
      if (!name.endsWith('.json')) continue;
      const previous: AgentRun = JSON.parse(await readFile(path.join(journal,name), 'utf8'));
      if (previous.projectId === input.projectId && previous.operationId === input.operationId) {
        if (previous.requestHash !== requestHash) throw new ProviderError('IDEMPOTENCY_CONFLICT', 'Operation ID belongs to another run.');
        return previous;
      }
      if (previous.projectId === input.projectId && ['submitted', 'running', 'unknown'].includes(previous.status)) throw new ProviderError('EXECUTOR_CONFLICT', 'The project already has an active or unresolved executor.');
    }
    const now = new Date().toISOString();
    const run: AgentRun = { id, requestHash, projectId: input.projectId, operationId: input.operationId, executionMode: input.executionMode, owner: input.owner, status: 'submitted', lease: { generation: 1, expiresAt: new Date(Date.now() + 60000).toISOString() }, createdAt: now, updatedAt: now, codeRevision: input.context.codeRevision, candidateDirectory: input.candidateDirectory, budget: input.budget, logs: [] };
    await save(run);
    try { const remote = await request('/runs', { ...input, runId: run.id, lease: run.lease }); if (!remote.id) throw new ProviderError('INVALID_WORKER_RESULT', 'Worker must return a persisted run ID.'); run.workerRunId = remote.id; run.status = 'running'; await save(run); return run; }
    catch (error) { run.status = 'unknown'; run.logs.push('Dispatch outcome uncertain; reconcile with worker before creating another run.'); await save(run); throw error; }
  };
  return {
    status,
    async list() {
      const {readdir} = await import('node:fs/promises');let names:string[];
      try {names=await readdir(journal);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
      const runs:AgentRun[]=[];for(const name of names)if(name.endsWith('.json'))runs.push(JSON.parse(await readFile(path.join(journal,name),'utf8')));
      return runs.map(({id,projectId,operationId,status,lease,codeRevision,budget,owner,createdAt,updatedAt})=>({id,projectId,operationId,status,lease,codeRevision,budget,owner,createdAt,updatedAt}));
    },
    start(input: AgentStartRequest) { const prev = perProject.get(input.projectId); const result = (prev ? prev.catch(()=>{}).then(()=>startOnce(input)) : startOnce(input)); perProject.set(input.projectId,result); result.finally(()=>{if(perProject.get(input.projectId)===result)perProject.delete(input.projectId);}).catch(()=>{}); return result; },
    async get(id: string) {
      const run = await load(id);
      if (run.workerRunId && run.status === 'running') {
        if (Date.parse(run.lease.expiresAt) <= Date.now()) { run.status = 'unknown'; run.logs.push('Execution lease expired; reconcile with worker before finalization.'); run.updatedAt = new Date().toISOString(); await save(run); return run; }
        const remote = await request('/runs/' + encodeURIComponent(run.workerRunId));
        if (!remote.status || !['running','completed','failed','cancelled'].includes(remote.status)) throw new ProviderError('INVALID_WORKER_RESULT', 'Worker status is invalid.');
        run.status = remote.status; run.logs = (remote.logs ?? []).slice(-100).map(x=>String(x).replaceAll(workerToken!, '[redacted]').slice(0,2000)); run.result = remote.result;
        run.updatedAt = new Date().toISOString();
        if (run.status === 'running') {
          if (Date.parse(run.lease.expiresAt) <= Date.now()) { run.status = 'unknown'; run.logs.push('Execution lease expired; reconcile with worker before finalization.'); }
          else { const lease = {generation:run.lease.generation,expiresAt:new Date(Date.now()+60000).toISOString()}; await request('/runs/' + encodeURIComponent(run.workerRunId) + '/heartbeat', {lease}); run.lease = lease; }
        }
        await save(run);
      }
      return run;
    },
    async cancel(id: string) { const run = await load(id); if (['completed','failed','cancelled'].includes(run.status)) return run; if (!run.workerRunId) throw new ProviderError('RUN_REQUIRES_RECONCILIATION', 'Dispatch outcome is unknown. Reconcile directly with worker.'); await request('/runs/' + encodeURIComponent(run.workerRunId) + '/cancel', {generation:run.lease.generation}); run.status='cancelled'; run.lease.generation++; run.lease.expiresAt=new Date().toISOString(); run.updatedAt=new Date().toISOString(); await save(run); return run; },
  };
}
