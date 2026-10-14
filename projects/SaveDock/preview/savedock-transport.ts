import { unavailable } from './notice';

const workspace = { id: 'preview-game', game_key: 'synthetic-game', name: '星河旅途（合成游戏）', path: 'preview://synthetic-game', process_name: null, version: 'fixture-1', store: '合成预览', route: 'main', base_snapshot: 'preview-snapshot-2', routes: { main: 'preview-snapshot-2' } };
const snapshots = [
  { id: 'preview-snapshot-2', game_key: 'synthetic-game', route: 'main', parents: ['preview-snapshot-1'], created_at: 1791633600, device: 'synthetic-device', note: '第二章 · 合成进度', kind: 'manual', source: null, files: { 'slot.sav': { hash: 'f5b6f68a5029f20cb5797b49d78b0b7e757ff021217f0d03756cefbf0dd69fb7', size: 32 } } },
  { id: 'preview-snapshot-1', game_key: 'synthetic-game', route: 'main', parents: [], created_at: 1791547200, device: 'synthetic-device', note: '第一章 · 合成进度', kind: 'manual', source: null, files: { 'slot.sav': { hash: 'e0de2a38a62be9c7d4cbcb4b0966c830dd5c9b4e2ec7beae0b295b980f45747e', size: 32 } } },
];
export async function previewTransport<T>(command: Record<string, unknown>): Promise<T> {
  if (command.action === 'list') return structuredClone({ workspaces: [{ workspace, changed: false, available: true, running: false, error: null }], pending: [], device: 'synthetic-device', vault: 'preview://memory-only' }) as T;
  if (command.action === 'history') return structuredClone({ snapshots, packages: {} }) as T;
  if (command.action === 'preview') {
    if (!snapshots.some(snapshot => snapshot.id === command.snapshot_id)) throw new Error('合成快照不存在');
    return { fingerprint: 'synthetic-readonly-plan', add: [], replace: ['slot.sav'], remove: [], total_bytes: 32, compatibility: 'synthetic preview only; no game files inspected' } as T;
  }
  throw unavailable('SaveDock ' + String(command.action));
}
