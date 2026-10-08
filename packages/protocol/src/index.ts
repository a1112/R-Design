export const PROTOCOL_VERSION = '1.0' as const;
export type Mode = 'observe' | 'interact' | 'design' | 'annotate';
export type FrameKind = 'live' | 'snapshot' | 'candidate' | 'reference' | 'design';
export interface Bounds { x: number; y: number; w: number; h: number }
export interface RuntimeVersion {
  runtimeSessionId: string; epoch: number; surfaceId: string;
  codeRevision: string; treeRevision: number; viewportRevision: number; geometryRevision: number;
}
export interface SourceBinding {
  sourceNodeId: string; file: string; line: number; column: number; fileHash: string;
  reliability: 'exact' | 'unmapped' | 'ambiguous'; scope: 'instance' | 'shared';
  editableProperties: string[];
}
export interface ObservedNode {
  runtimeNodeId: string; sourceNodeId?: string; instanceKey: string; parentId?: string;
  tag: string; role: string; text: string; bounds: Bounds;
  styles: Record<string, string>; binding?: SourceBinding;
}
export interface RuntimeTree { nodes: ObservedNode[]; treeRevision: number; geometryRevision: number; viewportRevision: number }
export interface RuntimeFrame extends RuntimeVersion {
  id: string; kind: FrameKind; timestamp: string; width: number; height: number;
  image: string; nodes: ObservedNode[];
  status: 'connecting' | 'live' | 'frozen' | 'stale' | 'disconnected' | 'build-failed' | 'resyncing';
}
export interface StrokePoint { x: number; y: number; pressure: number; time: number }
export interface Stroke { id: string; points: StrokePoint[]; color: string; width: number; nativeData?: string }
export interface Annotation {
  id: string; projectId: string; revision: number; createdAt: string;
  anchor: { type: 'object' | 'snapshot'; runtimeNodeId?: string; frameId: string; bounds: Bounds; version: RuntimeVersion };
  text: string; strokes: Stroke[]; status: 'comment' | 'confirmed' | 'task-created' | 'resolved';
  intent?: { version: number; summary: string; constraints: string[]; confirmedAt: string };
}
export interface Scenario {
  id: string; name: string; route: string; viewport: { width: number; height: number };
  steps: Array<{ action: 'click' | 'fill'; target: string; value?: string }>;
  readySelector: string; dependencies: string[]; status: 'fresh' | 'stale' | 'unverified';
  snapshotId?: string;
}
export interface Asset {
  id: string; name: string; kind: 'reference' | 'generated'; mime: string; hash: string; url: string;
  createdAt: string; provenance: { provider: string; model?: string; prompt?: string; operationId?: string; cost?: number; estimatedCostCeilingUsd?: number };
}
export interface Project {
  id: string; name: string; revision: number; codeRevision: string; annotations: Annotation[];
  snapshots: RuntimeFrame[]; scenarios: Scenario[]; assets: Asset[];
  designFrames: Array<{ id: string; name: string; nodes: Array<{ id: string; type: 'text' | 'rectangle'; bounds: Bounds; text?: string; color: string }> }>;
}
export interface Evidence { name: string; passed: boolean; detail: string; snapshot?: RuntimeFrame }
export interface FilePatch { file: string; before: string; after: string; beforeHash: string; afterHash: string }
export interface ChangeSet {
  id: string; projectId: string; operationId: string; expectedRevision: number;
  status: 'prepared' | 'verifying' | 'verified' | 'failed' | 'accepted' | 'reverted' | 'discarded';
  intent: string; createdAt: string; baseCodeRevision: string; diffHash: string;
  patches: FilePatch[]; evidence: Evidence[]; candidateFrame?: RuntimeFrame;
  error?: string; acceptedAt?: string; annotationId?: string;
}
export interface ChangeRequest {
  projectId: string; expectedRevision: number; operationId: string;
  nodeId: string; sourceNodeId: string; version: RuntimeVersion; intent: string;
  properties: Record<string, string | number>; scope: 'instance' | 'shared'; annotationId?: string; executionMode?: 'agent';
}
export interface BridgeState {
  project: Project; frame: RuntimeFrame | null; changes: ChangeSet[];
  capabilities: { capture: boolean; structure: boolean; source: boolean; input: boolean; properties: boolean; agent: boolean; assets: boolean };
  providerStatus: { agent: string; assets: string }; devices: Array<{ id: string; name: string; expiresAt: string }>;
}
export interface WriteEnvelope { projectId: string; expectedRevision: number; operationId: string }
export interface BridgeError { error: { code: string; message: string; retryable: boolean } }
export type ServerEvent = { type: 'frame'; frame: RuntimeFrame } | { type: 'state'; state: BridgeState } | { type: 'error'; error: BridgeError['error'] };
export function sameRuntime(a: RuntimeVersion, b: RuntimeVersion) {
  return a.runtimeSessionId === b.runtimeSessionId && a.epoch === b.epoch && a.surfaceId === b.surfaceId;
}
export function sameTargetVersion(a: RuntimeVersion, b: RuntimeVersion) {
  return sameRuntime(a,b) && a.codeRevision === b.codeRevision && a.treeRevision === b.treeRevision && a.viewportRevision === b.viewportRevision && a.geometryRevision === b.geometryRevision;
}
