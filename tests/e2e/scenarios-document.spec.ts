import { test, expect } from '@playwright/test';
import { BridgeClient, baseURL } from './bridge-client';

test('AT-12 registered scene refresh creates new immutable evidence and the project exports independently of chat', async ({ request }) => {
  const client = await new BridgeClient(request).connect();
  const before = await client.live();
  expect(before.project.scenarios.length).toBeGreaterThanOrEqual(3);
  const captured: Array<{ id: string; image: string; codeRevision: string }> = [];
  for (const scenario of before.project.scenarios) {
    const response = await client.post(`/scenarios/${scenario.id}/capture`, await client.envelope());
    const snapshot = await response.json();
    expect(snapshot.kind).toBe('snapshot');
    expect(snapshot.status).toBe('frozen');
    expect(snapshot.image).toMatch(/^data:image\/png;base64,/);
    expect(snapshot.width).toBe(scenario.viewport.width);
    expect(snapshot.height).toBe(scenario.viewport.height);
    captured.push(snapshot);
  }
  const firstScenario = before.project.scenarios[0];
  const refreshedResponse = await client.post(`/scenarios/${firstScenario.id}/capture`, await client.envelope());
  const refreshed = await refreshedResponse.json();
  expect(refreshed.id).not.toBe(captured[0].id);
  const after = await client.live();
  for (const snapshot of captured) {
    const historical = after.project.snapshots.find(frame => frame.id === snapshot.id);
    expect(historical?.image).toBe(snapshot.image);
    expect(historical?.codeRevision).toBe(snapshot.codeRevision);
  }
  expect(after.project.scenarios.find(scenario => scenario.id === firstScenario.id)?.snapshotId).toBe(refreshed.id);
  expect(after.project.scenarios.every(scenario => scenario.status === 'fresh')).toBeTruthy();
  expect(after.changes).toHaveLength(before.changes.length);
  const exportedResponse = await request.get(`${baseURL}/api/export`, { headers: client.headers });
  expect(exportedResponse.ok(), await exportedResponse.text()).toBeTruthy();
  const exported = await exportedResponse.json();
  expect(exported.schemaVersion).toBe(1);
  expect(exported.project.id).toBe(after.project.id);
  expect(exported.project.snapshots.some((frame: { id: string }) => frame.id === captured[0].id)).toBeTruthy();
  expect(exported.project.annotations).toEqual(after.project.annotations);
});
