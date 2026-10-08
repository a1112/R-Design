import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeClient, runtimeVersion } from './bridge-client';

test('AT-06 a real source build failure marks retained pixels stale, blocks input, and recovers with a new runtime epoch', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  const button = before.frame.nodes.find(node => node.sourceNodeId === 'start-button')!;
  const sourcePath = path.join(process.env.RDESIGN_E2E_WORKSPACE!, button.binding!.file);
  const source = await readFile(sourcePath, 'utf8');
  await client.post('/mode', { ...(await client.envelope()), mode: 'interact' });
  try {
    await writeFile(sourcePath, `${source}\nconst e2eCompileFailure = <;\n`);
    await expect.poll(async () => (await client.state()).frame?.status, { timeout: 35_000 }).not.toBe('live');
    const failed = await client.state();
    expect(['build-failed', 'stale', 'disconnected']).toContain(failed.frame?.status);
    const rejectedInput = await request.post(`${process.env.RDESIGN_E2E_URL}/api/input`, { headers: client.headers, data: { ...(await client.envelope()), version: runtimeVersion(before.frame), action: 'click', x: button.bounds.x + 1, y: button.bounds.y + 1 } });
    expect(rejectedInput.ok(), 'A retained image cannot authorize input into a failed current source').toBeFalsy();
    expect(failed.capabilities.input).toBeFalsy();
  } finally { await writeFile(sourcePath, source); }
  const recovered = await client.live();
  await expect.poll(async () => (await client.live()).frame.epoch, { timeout: 30_000 }).toBeGreaterThan(before.frame.epoch);
  expect(recovered.frame.runtimeSessionId).toBe(before.frame.runtimeSessionId);
  expect(recovered.frame.nodes.find(node => node.sourceNodeId === 'start-button')?.text).toBe('开始监控');
  await client.post('/mode', { ...(await client.envelope()), mode: 'observe' });
});
