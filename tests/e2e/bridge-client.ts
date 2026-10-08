import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Annotation, BridgeState, RuntimeFrame, RuntimeVersion, ServerEvent } from '../../packages/protocol/src/index';

export const baseURL = process.env.RDESIGN_E2E_URL ?? 'http://127.0.0.1:4410';
export const runtimeVersion = (frame: RuntimeVersion): RuntimeVersion => ({
  runtimeSessionId: frame.runtimeSessionId, epoch: frame.epoch, surfaceId: frame.surfaceId,
  codeRevision: frame.codeRevision, treeRevision: frame.treeRevision,
  viewportRevision: frame.viewportRevision, geometryRevision: frame.geometryRevision,
});

export class BridgeClient {
  token = '';
  constructor(readonly request: APIRequestContext) {}
  async connect() {
    const response = await this.request.get(`${baseURL}/api/bootstrap`);
    expect(response.ok(), await response.text()).toBeTruthy();
    this.token = (await response.json()).token;
    return this;
  }
  get headers() { return { Authorization: `Bearer ${this.token}` }; }
  async state(): Promise<BridgeState> {
    const response = await this.request.get(`${baseURL}/api/state`, { headers: this.headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  async live(): Promise<BridgeState & { frame: RuntimeFrame }> {
    await expect.poll(async () => (await this.state()).frame?.status, { timeout: 30_000 }).toBe('live');
    return this.state() as Promise<BridgeState & { frame: RuntimeFrame }>;
  }
  async post(path: string, body: unknown, expectedStatus?: number) {
    const response = await this.request.post(`${baseURL}/api${path}`, { headers: this.headers, data: body });
    if (expectedStatus !== undefined) expect(response.status(), await response.text()).toBe(expectedStatus);
    else expect(response.ok(), await response.text()).toBeTruthy();
    return response;
  }
  async envelope(operationId = randomUUID()) {
    const { project } = await this.state();
    return { projectId: project.id, expectedRevision: project.revision, operationId };
  }
  async annotation(text: string, id = randomUUID()): Promise<Annotation> {
    const { project, frame } = await this.live();
    const target = frame.nodes.find(node => node.sourceNodeId === 'start-button' || node.runtimeNodeId === 'start-button');
    expect(target, 'Fixture must expose the actual mapped button').toBeTruthy();
    return {
      id, projectId: project.id, revision: 0, createdAt: new Date().toISOString(),
      anchor: { type: 'snapshot', frameId: frame.id, bounds: target!.bounds, version: runtimeVersion(frame) },
      text, status: 'comment',
      strokes: [{ id: `stroke-${id}`, color: '#ffb44d', width: 3, points: [
        { x: target!.bounds.x, y: target!.bounds.y, pressure: 0.5, time: 0 },
        { x: target!.bounds.x + 22, y: target!.bounds.y + 9, pressure: 0.8, time: 12 },
      ] }],
    };
  }
}

export class FrameObserver {
  readonly events: ServerEvent[] = [];
  readonly socket: WebSocket;
  private constructor(token: string) {
    this.socket = new WebSocket(`${baseURL.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
    this.socket.on('message', data => this.events.push(JSON.parse(String(data))));
  }
  static async connect(token: string) {
    const observer = new FrameObserver(token);
    await new Promise<void>((resolve, reject) => { observer.socket.once('open', () => resolve()); observer.socket.once('error', reject); });
    return observer;
  }
  get frames(): RuntimeFrame[] {
    return this.events.flatMap(event => event.type === 'frame' ? [event.frame] : event.type === 'state' && event.state.frame ? [event.state.frame] : []);
  }
  close() { this.socket.close(); }
}
