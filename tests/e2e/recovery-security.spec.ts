import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeClient, FrameObserver, baseURL, runtimeVersion } from './bridge-client';

test('AT-08 offline-record replay is persisted once, reconnect restores raw strokes, and an unconfirmed annotation does not execute', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  const annotation = await client.annotation('离线批注：将文字改为立即开始，圆角 12；等待确认。');
  const body = { ...(await client.envelope()), annotation };
  await client.post('/annotations', body);
  const first = await client.state();
  await client.post('/annotations', body);
  const replayed = await client.state();
  expect(replayed.project.revision).toBe(first.project.revision);
  expect(replayed.project.annotations.filter(item => item.id === annotation.id)).toHaveLength(1);
  expect(replayed.project.annotations.find(item => item.id === annotation.id)?.strokes).toEqual(annotation.strokes);
  expect(replayed.changes).toHaveLength(before.changes.length);
  const current = await client.live();
  const target = current.frame.nodes.find(node => node.sourceNodeId === 'start-button')!;
  const unconfirmed = await client.post('/changes/prepare', { ...(await client.envelope()), annotationId: annotation.id, nodeId: target.runtimeNodeId, sourceNodeId: 'start-button', version: runtimeVersion(current.frame), intent: annotation.text, properties: { text: '不应执行' }, scope: 'instance' }, 400);
  expect((await unconfirmed.json()).error.code).toBe('INTENT_UNCONFIRMED');
  const saved = JSON.parse(await readFile(path.join(process.env.RDESIGN_E2E_ROOT!, 'data', 'project.json'), 'utf8'));
  expect(saved.project.annotations.find((item: { id: string }) => item.id === annotation.id)?.strokes).toEqual(annotation.strokes);
  const observer = await FrameObserver.connect(client.token);
  try {
    await expect.poll(() => observer.events.some(event => event.type === 'state' && event.state.project.annotations.some(item => item.id === annotation.id))).toBeTruthy();
  } finally { observer.close(); }
  const collision = await client.post('/annotations', { ...body, annotation: { ...annotation, text: '不同操作不可复用同一幂等键' } }, 409);
  expect((await collision.json()).error.code).toBe('OPERATION_COLLISION');
});

test('API authentication, foreign Origin, project/document versions, and old runtime generations fail closed', async ({ request }) => {
  const unauthenticated = await request.get(`${baseURL}/api/state`);
  expect(unauthenticated.status()).toBe(401);
  const foreignOrigin = await request.get(`${baseURL}/api/bootstrap`, { headers: { Origin: 'https://attacker.example' } });
  expect(foreignOrigin.status()).toBe(403);
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  const foreignWrite = await request.post(`${baseURL}/api/mode`, { headers: { ...client.headers, Origin: 'https://attacker.example' }, data: { ...(await client.envelope()), mode: 'interact' } });
  expect(foreignWrite.status()).toBe(403);
  const staleRevision = await client.post('/snapshots', { ...(await client.envelope()), expectedRevision: before.project.revision - 1 }, 409);
  expect((await staleRevision.json()).error.code).toBe('REVISION_CONFLICT');
  const mismatchedProject = await client.post('/snapshots', { ...(await client.envelope()), projectId: 'project_other' }, 400);
  expect((await mismatchedProject.json()).error.code).toBe('PROJECT_MISMATCH');
  await client.post('/mode', { ...(await client.envelope()), mode: 'interact' });
  const current = await client.live();
  const staleInput = await client.post('/input', { ...(await client.envelope()), version: { ...runtimeVersion(current.frame), epoch: current.frame.epoch + 1 }, action: 'click', x: 12, y: 12 }, 409);
  expect((await staleInput.json()).error.code).toBe('STALE_RUNTIME');
  await client.post('/mode', { ...(await client.envelope()), mode: 'observe' });
});

test('import rejects traversal and active assets while preserving the current project', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  const document = { schemaVersion: 1, project: before.project, changes: [] };
  const withPath = { ...document, project: { ...before.project, scenarios: [{ ...before.project.scenarios[0], dependencies: ['../../outside.tsx'] }] } };
  const traversal = await client.post('/import', { ...(await client.envelope()), document: withPath }, 400);
  expect((await traversal.json()).error.code).toBe('IMPORT_PATH');
  const activeAsset = { ...document, project: { ...before.project, assets: [{ id: 'evil', name: 'Active SVG', kind: 'reference', mime: 'image/svg+xml', hash: 'invalid', url: 'data:image/svg+xml;base64,PHN2Zz4=', createdAt: new Date().toISOString(), provenance: { provider: 'external' } }] } };
  const rejectedAsset = await client.post('/import', { ...(await client.envelope()), document: activeAsset }, 400);
  expect((await rejectedAsset.json()).error.code).toBe('IMPORT_ASSET');
  const after = await client.state();
  expect(after.project.revision).toBe(before.project.revision);
  expect(after.project.id).toBe(before.project.id);
});

test('AT-11 one-time pairing, exclusive input lease and revocation terminate device access', async ({ request }) => {
  const desktop = await new BridgeClient(request).connect();
  await desktop.live();
  const codeResponse = await desktop.post('/pairing/code', await desktop.envelope());
  const { code } = await codeResponse.json();
  const redemption = await request.post(`${baseURL}/api/pairing/redeem`, { data: { code, name: 'E2E paired tablet' } });
  expect(redemption.ok(), await redemption.text()).toBeTruthy();
  const { token, deviceId } = await redemption.json();
  const secondRedemption = await request.post(`${baseURL}/api/pairing/redeem`, { data: { code, name: 'Replay device' } });
  expect(secondRedemption.status()).toBe(403);
  const paired = new BridgeClient(request); paired.token = token;
  expect((await paired.state()).project.id).toBe((await desktop.state()).project.id);
  const observer = await FrameObserver.connect(token);
  try {
    await paired.post('/mode', { ...(await paired.envelope()), mode: 'interact' });
    const leaseFailure = await desktop.post('/mode', { ...(await desktop.envelope()), mode: 'interact' }, 409);
    expect((await leaseFailure.json()).error.code).toBe('INPUT_LEASE');
    const closed = new Promise<number>(resolve => observer.socket.once('close', resolve));
    await desktop.post(`/devices/${deviceId}/revoke`, await desktop.envelope());
    expect(await closed).toBe(1008);
    const revokedState = await request.get(`${baseURL}/api/state`, { headers: paired.headers });
    expect(revokedState.status()).toBe(401);
    const state = await desktop.live();
    const input = await request.post(`${baseURL}/api/input`, { headers: paired.headers, data: { ...(await desktop.envelope()), version: runtimeVersion(state.frame), action: 'key', key: 'Escape' } });
    expect(input.status()).toBe(401);
    expect((await desktop.state()).devices.some(device => device.id === deviceId)).toBeFalsy();
  } finally { observer.close(); }
});

test('Vite workbench and preview cannot serve Bridge internals through @fs', async ({ request }) => {
  const privateSource = new URL('../../apps/bridge/src/security.ts', import.meta.url).pathname;
  for (const origin of [baseURL, 'http://127.0.0.1:4411']) {
    const response = await request.get(`${origin}/@fs${privateSource}`);
    expect(response.status(), `${origin} must deny source outside its frontend/runtime allowlist`).toBe(403);
    expect(await response.text()).not.toContain('class Authenticator');
  }
  const foreignFrontendOrigin = await request.get(baseURL, { headers: { Origin: 'https://attacker.example' } });
  expect(foreignFrontendOrigin.status()).toBe(403);
});
