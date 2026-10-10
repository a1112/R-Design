import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoke, isTauri } from './preview/native';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const staged = path.resolve(import.meta.dirname, '../../../deliverables/staged');
const { previewApi } = await import(pathToFileURL(path.join(staged, 'R-Clip/src/rdesign-preview/clip-api.ts')).href);
const { previewTransport } = await import(pathToFileURL(path.join(staged, 'SaveDock/src/rdesign-preview/savedock-transport.ts')).href);
const { restrictPreviewBridge } = await import(pathToFileURL(path.join(staged, 'ToolBox/src/rdesign-preview/toolbox-bridge.ts')).href);

(globalThis as any).document = { getElementById: () => null };

test('clipboard fixture has synthetic provenance and cannot execute native writes', async () => {
  const page = await previewApi('query', { query: { search: 'design-preview' } });
  assert.equal(page.total, 2);
  assert.ok(page.items.every((item: any) => item.source.confidence === 'synthetic'));
  const detail = await previewApi('detail', { id: 'preview-note' });
  detail.text = 'mutated outside adapter';
  assert.notEqual((await previewApi('detail', { id: 'preview-note' })).text, detail.text);
  for (const command of ['copy_item', 'save_policy', 'delete_item', 'quit', 'pin']) await assert.rejects(previewApi(command), (error: any) => error.code === 'DESKTOP_REQUIRED' && error.executed === false);
});

test('SaveDock fixture exposes only hypothetical read models and no file receipts', async () => {
  const library = await previewTransport({ action: 'list' });
  assert.equal(library.vault, 'preview://memory-only');
  assert.ok(library.workspaces.every((item: any) => item.workspace.path.startsWith('preview://')));
  for (const action of ['backup', 'apply', 'register', 'download', 'sync', 'export', 'recover']) await assert.rejects(previewTransport({ action }), /未执行/);
  assert.equal((await previewTransport({ action: 'preview', snapshot_id: 'preview-snapshot-1' })).compatibility, 'synthetic preview only; no game files inspected');
});

test('hardware fixture read methods survive while native effects fail explicitly', async () => {
  const bridge = restrictPreviewBridge({
    read: async () => ({ origin: 'demo' }),
    startBenchmark: async () => ({ state: 'complete' }),
    exportReport: async () => ({ fileName: 'pretend.json' }),
  });
  assert.deepEqual(await bridge.read(), { origin: 'demo' });
  for (const name of ['startBenchmark', 'startStressTest', 'stopTest', 'exportReport', 'reexportReport', 'openReportsDirectory']) await assert.rejects((bridge as any)[name](), (error: any) => error.code === 'unsupported' && error.details.includes('no native action executed'));
});

test('native adapter cannot create a desktop identity or return a successful invoke', async () => {
  assert.equal(isTauri(), false);
  await assert.rejects(invoke('auth_login', { password: 'test-only' }), /未执行/);
});

test('large committed PNG chunks reconstruct the original bytes through the preview module', async () => {
  const root = path.join(staged, 'ToolBox');
  const ledger = JSON.parse(await readFile(path.join(root, 'src/rdesign-preview/provenance.json'), 'utf8'));
  const { resourceUrls } = await import(pathToFileURL(path.join(root, 'src/rdesign-preview/resource-urls.ts')).href);
  assert.ok(ledger.splitResources.length > 0);
  for (const resource of ledger.splitResources) {
    const url = resourceUrls[path.basename(resource.file)];
    assert.match(url, /^blob:/);
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    assert.equal(bytes.length, resource.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256);
    URL.revokeObjectURL(url);
  }
});
