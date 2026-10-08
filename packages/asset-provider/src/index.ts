import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Asset } from '../../protocol/src/index.js';

export class ProviderError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}
export interface AssetGenerationRequest {
  projectId: string; expectedRevision: number; operationId: string;
  prompt: string; name?: string; budgetUsd: number; externalGenerationApproved: true;
}
export interface GeneratedAssetInput {
  bytes: Buffer; name: string; mime: string;
  provenance: { provider: string; model: string; prompt: string; operationId: string; estimatedCostCeilingUsd: number };
}
interface RecordEntry { requestHash: string; status: 'submitted' | 'completed' | 'failed' | 'unknown'; asset?: Asset; error?: string }
export function createAssetProvider(options: {
  directory: string; storeAsset: (asset: GeneratedAssetInput) => Promise<Asset>;
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch;
}) {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  const model = env.RDESIGN_IMAGE_MODEL;
  const costCeiling = Number(env.RDESIGN_IMAGE_COST_CEILING_USD);
  const limit = Number(env.RDESIGN_ASSET_MAX_BUDGET_USD ?? '1');
  const configured = !!apiKey && !!model && Number.isFinite(costCeiling) && costCeiling > 0 && Number.isFinite(limit) && limit > 0;
  const journal = path.join(options.directory, 'provider-assets');
  const inflight = new Map<string, Promise<Asset>>();
  const status = () => configured ? 'configured:openai-image' : 'unavailable: configure OPENAI_API_KEY, RDESIGN_IMAGE_MODEL and RDESIGN_IMAGE_COST_CEILING_USD';
  const save = async (file: string, entry: RecordEntry) => {
    await writeFile(file + '.tmp', JSON.stringify(entry), { mode: 0o600 });
    await rename(file + '.tmp', file);
  };
  const generateOnce = async (input: AssetGenerationRequest): Promise<Asset> => {
    if (!configured) throw new ProviderError('PROVIDER_UNAVAILABLE', status());
    if (!input.externalGenerationApproved) throw new ProviderError('EXTERNAL_GENERATION_NOT_APPROVED', 'This request must explicitly approve external image generation.');
    if (!input.operationId || !input.projectId || !input.prompt?.trim() || input.prompt.length > 12000) throw new ProviderError('INVALID_INPUT', 'Supply project, operation and a prompt of at most 12000 characters.');
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0 || input.budgetUsd > limit || costCeiling > input.budgetUsd) throw new ProviderError('BUDGET_EXCEEDED', 'Configured request cost ceiling must fit the approved budget and server limit.');
    await mkdir(journal, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update(input.projectId + ':' + input.operationId).digest('hex');
    const {expectedRevision: _expectedRevision, ...logicalRequest} = input;
    const requestHash = createHash('sha256').update(JSON.stringify({ ...logicalRequest, model, costCeiling })).digest('hex');
    const file = path.join(journal, key + '.json');
    let previous: RecordEntry | undefined;
    try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ProviderError('IDEMPOTENCY_CONFLICT', 'Operation ID belongs to another generation request.');
      if (previous.status === 'completed' && previous.asset) return previous.asset;
      throw new ProviderError('GENERATION_REQUIRES_RECONCILIATION', previous.error ?? 'A previous request may have been billed. Review its journal before creating a new operation.');
    }
    await save(file, { requestHash, status: 'submitted' });
    try {
      const response = await (options.fetch ?? fetch)('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: input.prompt, n: 1, size: '1024x1024', quality: 'low', output_format: 'png' }),
        signal: AbortSignal.timeout(180000), redirect: 'error',
      });
      if (!response.ok) { await save(file, { requestHash, status: 'failed', error: `Provider returned HTTP ${response.status}.` }); throw new ProviderError('PROVIDER_REJECTED', `Image provider returned HTTP ${response.status}.`); }
      const result = await response.json() as { data?: Array<{ b64_json?: string }> };
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded) throw new ProviderError('INVALID_PROVIDER_RESULT', 'Image provider did not return image bytes.');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new ProviderError('INVALID_PROVIDER_RESULT', 'Provider image is not a bounded PNG.');
      const asset = await options.storeAsset({ bytes, name: input.name || 'Generated image', mime: 'image/png', provenance: { provider: 'openai', model: model!, prompt: input.prompt, operationId: input.operationId, estimatedCostCeilingUsd: costCeiling } });
      await save(file, { requestHash, status: 'completed', asset });
      return asset;
    } catch (error) {
      if (!(error instanceof ProviderError && error.code === 'PROVIDER_REJECTED')) await save(file, { requestHash, status: 'unknown', error: 'Provider outcome is uncertain; automatic replay is disabled.' });
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('GENERATION_OUTCOME_UNKNOWN', 'Image request was interrupted; reconcile before retrying.');
    }
  };
  return { status, generate(input: AssetGenerationRequest) {
    const key = input.projectId + ':' + input.operationId;
    const existing = inflight.get(key);
    // Concurrent duplicate bodies are still checked against the persisted request fingerprint.
    if (existing) return existing.then(() => generateOnce(input));
    const result = generateOnce(input); inflight.set(key, result);
    result.finally(() => inflight.delete(key)).catch(() => {});
    return result;
  } };
}
