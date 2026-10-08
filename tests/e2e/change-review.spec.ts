import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../../packages/protocol/src/index';
import { BridgeClient, runtimeVersion } from './bridge-client';

async function prepareButton(client: BridgeClient, text = '立即开始', annotationId?: string): Promise<ChangeSet> {
  const { project, frame } = await client.live();
  const target = frame.nodes.find(node => node.sourceNodeId === 'start-button');
  expect(target?.binding?.reliability).toBe('exact');
  const response = await client.post('/changes/prepare', {
    ...(await client.envelope()), nodeId: target!.runtimeNodeId, sourceNodeId: 'start-button',
    version: runtimeVersion(frame), intent: '将此按钮文字改为立即开始，圆角改为 12；保留点击监控行为。',
    properties: { text, borderRadius: 12 }, scope: 'instance', annotationId,
  });
  const result = await response.json();
  return result.change ?? result;
}
async function changeAction(client: BridgeClient, change: ChangeSet, action: string, extra: object = {}, expectedStatus?: number) {
  return client.post(`/changes/${change.id}/${action}`, { ...(await client.envelope()), ...extra }, expectedStatus);
}

test('AT-05/07/09 real candidate review rejects source conflict, accepts the approved diff, and preserves a later independent edit on revert', async ({ request }, testInfo) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  const annotation = await client.annotation('文字改为立即开始，圆角 12；保留点击行为。');
  await client.post('/annotations', { ...(await client.envelope()), annotation });
  await client.post(`/annotations/${annotation.id}/confirm`, { ...(await client.envelope()), intent: { version: 1, summary: annotation.text, constraints: ['保留点击监控行为', '验证桌面和窄屏场景'] } });
  const change = await prepareButton(client, '立即开始', annotation.id);
  expect(change.status).toBe('prepared');
  expect(change.patches).toHaveLength(1);
  expect(change.patches[0].before).toContain('开始监控');
  expect(change.patches[0].after).toContain('立即开始');
  expect(change.patches[0].after).toContain('borderRadius: 12');
  await changeAction(client, change, 'apply', { diffHash: change.diffHash }, 409);
  const verificationResponse = await changeAction(client, change, 'verify');
  const verifiedResult = await verificationResponse.json();
  const verified: ChangeSet = verifiedResult.change ?? verifiedResult;
  expect(verified.status, JSON.stringify({ error: verified.error, evidence: verified.evidence.map(({ name, passed, detail }) => ({ name, passed, detail })) }, null, 2)).toBe('verified');
  expect(verified.evidence.length).toBeGreaterThanOrEqual(4);
  expect(verified.evidence.every(evidence => evidence.passed)).toBeTruthy();
  expect(verified.candidateFrame?.kind).toBe('candidate');
  expect(verified.candidateFrame?.codeRevision).not.toBe(before.frame.codeRevision);
  expect(verified.candidateFrame?.image).toMatch(/^data:image\/png;base64,/);
  const candidateButton = verified.candidateFrame!.nodes.find(node => node.sourceNodeId === 'start-button');
  expect(candidateButton?.text).toBe('立即开始');
  expect(candidateButton?.styles.borderRadius).toBe('12px');
  await testInfo.attach('candidate-real-runtime.png', { body: Buffer.from(verified.candidateFrame!.image.split(',')[1], 'base64'), contentType: 'image/png' });
  await testInfo.attach('verified-evidence.json', { body: JSON.stringify(verified, null, 2), contentType: 'application/json' });
  expect((await client.live()).frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text).toBe('开始监控');

  const sourcePath = path.join(process.env.RDESIGN_E2E_WORKSPACE!, change.patches[0].file);
  const originalSource = await readFile(sourcePath, 'utf8');
  const externalEdit = `${originalSource}\n// E2E external edit must survive a rejected acceptance.\n`;
  try {
    await writeFile(sourcePath, externalEdit);
    const conflict = await changeAction(client, verified, 'apply', { diffHash: verified.diffHash }, 409);
    expect((await conflict.json()).error.code).toBe('SOURCE_CONFLICT');
    expect(await readFile(sourcePath, 'utf8')).toBe(externalEdit);
  } finally { await writeFile(sourcePath, originalSource); }

  const wrongApproval = await changeAction(client, verified, 'apply', { diffHash: 'wrong-approval' }, 409);
  expect((await wrongApproval.json()).error.code).toBe('APPROVAL_HASH');
  await changeAction(client, verified, 'apply', { diffHash: verified.diffHash });
  await expect.poll(async () => (await client.live()).frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text, { timeout: 30_000 }).toBe('立即开始');
  const accepted = await client.live();
  expect(accepted.project.codeRevision).not.toBe(before.project.codeRevision);
  expect(accepted.changes.find(item => item.id === verified.id)?.status).toBe('accepted');
  expect(accepted.project.annotations.find(item => item.id === annotation.id)?.status).toBe('resolved');
  expect(accepted.project.scenarios.every(scenario => scenario.status === 'stale')).toBeTruthy();

  const acceptedSource = await readFile(sourcePath, 'utf8');
  const overlappingEdit = acceptedSource.replace(JSON.stringify('立即开始'), JSON.stringify('外部后续文字'));
  expect(overlappingEdit).not.toBe(acceptedSource);
  try {
    await writeFile(sourcePath, overlappingEdit);
    const revertConflict = await changeAction(client, verified, 'revert', {}, 409);
    expect((await revertConflict.json()).error.code).toBe('REVERT_CONFLICT');
    expect(await readFile(sourcePath, 'utf8')).toBe(overlappingEdit);
  } finally { await writeFile(sourcePath, acceptedSource); }
  const independentMarker = '// E2E independent change after acceptance.';
  await writeFile(sourcePath, `${acceptedSource}\n${independentMarker}\n`);
  await changeAction(client, verified, 'revert');
  expect(await readFile(sourcePath, 'utf8')).toContain(independentMarker);
  await expect.poll(async () => (await client.live()).frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text, { timeout: 30_000 }).toBe('开始监控');
  expect((await client.state()).changes.find(item => item.id === verified.id)?.status).toBe('reverted');
});

test('AT-04 ambiguous shared list nodes and stale surface generations cannot create a candidate', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const initial = await client.live();
  const shared = initial.frame.nodes.find(node => node.sourceNodeId === 'device-row');
  expect(shared?.binding?.reliability).toBe('ambiguous');
  const sharedResponse = await client.post('/changes/prepare', {
    ...(await client.envelope()), nodeId: shared!.runtimeNodeId, sourceNodeId: 'device-row', version: runtimeVersion(initial.frame),
    intent: '只修改这一行', properties: { text: '错误范围' }, scope: 'instance',
  }, 409);
  expect((await sharedResponse.json()).error.code).toBe('UNMAPPED_TARGET');
  const latest = await client.live();
  const button = latest.frame.nodes.find(node => node.sourceNodeId === 'start-button')!;
  const staleResponse = await client.post('/changes/prepare', {
    ...(await client.envelope()), nodeId: button.runtimeNodeId, sourceNodeId: 'start-button',
    version: { ...runtimeVersion(latest.frame), epoch: latest.frame.epoch + 1 },
    intent: '过期页面不得写入', properties: { text: '不应出现' }, scope: 'instance',
  }, 409);
  expect((await staleResponse.json()).error.code).toBe('STALE_RUNTIME');
  expect((await client.state()).changes).toHaveLength(initial.changes.length);
});
