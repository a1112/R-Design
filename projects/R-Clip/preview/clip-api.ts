// The synthetic records contain no data obtained from the host clipboard.
type Snippet = { id: string; title: string; kind: string; text: string; created_at: number; last_seen_at: number; repeat_count: number; pinned: boolean; tags: string[]; source: { app_id: null; app_name: string; confidence: string }; byte_len: number; width: null; height: null; thumbnail: null; image: null; sort_key: number };
const clock = Date.UTC(2026, 9, 10, 12);
const records: Snippet[] = [
  { id: 'preview-note', title: 'design-preview · 合成笔记', kind: 'text', text: '此片段由设计适配器创建。没有读取系统剪贴板。', created_at: clock, last_seen_at: clock, repeat_count: 1, pinned: true, tags: ['synthetic'], source: { app_id: null, app_name: '设计预览生成器', confidence: 'synthetic' }, byte_len: 81, width: null, height: null, thumbnail: null, image: null, sort_key: 3 },
  { id: 'preview-link', title: 'https://example.invalid/design-preview', kind: 'link', text: 'https://example.invalid/design-preview', created_at: clock - 60000, last_seen_at: clock - 60000, repeat_count: 1, pinned: false, tags: ['synthetic'], source: { app_id: null, app_name: '设计预览生成器', confidence: 'synthetic' }, byte_len: 38, width: null, height: null, thumbnail: null, image: null, sort_key: 2 },
  { id: 'preview-code', title: 'const previewOnly = true;', kind: 'code', text: 'const previewOnly = true; // synthetic fixture', created_at: clock - 120000, last_seen_at: clock - 120000, repeat_count: 1, pinned: false, tags: ['synthetic'], source: { app_id: null, app_name: '设计预览生成器', confidence: 'synthetic' }, byte_len: 46, width: null, height: null, thumbnail: null, image: null, sort_key: 1 },
];
const status = {
  policy: { recording: false, retention_days: 7, max_items: 100, max_bytes: 1048576, strict_unknown: true, excluded_apps: [], shortcut: '', theme: 'light', autostart: false },
  locked: false, storage_error: null, host_error: '合成记录 · 未连接系统剪贴板，录制和写入不可用。', shortcut_error: true, revision: 1, skipped: 0, host_mode: 'design-preview-readonly', encryption: '无真实存储（一次性合成预览）',
};
export async function previewApi<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (command === 'status') return structuredClone(status) as T;
  if (command === 'query') {
    const q = (args.query ?? {}) as { search?: string; kind?: string; pinned?: boolean; tag?: string; since?: number; until?: number };
    const search = (q.search ?? '').toLowerCase();
    const items = records.filter(item => (!search || [item.title, item.text, ...item.tags].join(' ').toLowerCase().includes(search)) && (!q.kind || item.kind === q.kind) && (!q.pinned || item.pinned) && (!q.tag || item.tags.includes(q.tag)) && (!q.since || item.last_seen_at >= q.since) && (!q.until || item.last_seen_at <= q.until));
    return structuredClone({ items, total: items.length, counts: { all: 3, text: 1, link: 1, code: 1, image: 0, pinned: 1 }, tags: ['synthetic'], next: null, snapshot: 1 }) as T;
  }
  if (command === 'detail') {
    const item = records.find(item => item.id === args.id);
    if (!item) throw { code: 'NOT_FOUND' };
    return structuredClone(item) as T;
  }
  if (command === 'stats') return { bytes: 165, pinned_bytes: 81, count: 3 } as T;
  if (command === 'diagnostics') return 'DESIGN PREVIEW: 合成记录；没有读取系统剪贴板、钥匙串、文件或原生诊断。' as T;
  throw { code: 'DESKTOP_REQUIRED', preview_only: true, executed: false };
}
