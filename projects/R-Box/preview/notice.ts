interface PreviewInfo { name: string; notice: string; source: { repository: string; commit: string } }
const memory = (): Storage => {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, getItem: key => values.get(String(key)) ?? null, setItem: (key, value) => { values.set(String(key), String(value)); }, removeItem: key => { values.delete(String(key)); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null };
};
export function unavailable(action: string): Error & { code: string } {
  const error = Object.assign(new Error(`设计预览不支持原生或外部操作：${action}；未执行。`), { code: 'NATIVE_REQUIRED' });
  const status = document.getElementById('rdesign-preview-operation');
  if (status) { status.textContent = error.message; status.hidden = false; }
  return error;
}
export function mountPreview(info: PreviewInfo) {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memory() });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memory() });
  const fetchResource = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const resource = url.origin === location.origin && /^\/(?:src\/|assets\/|node_modules\/|@|__vite)/.test(url.pathname);
    if (resource) return fetchResource(input, init);
    throw unavailable('网络服务（未连接）');
  };
  const clipboard = navigator.clipboard;
  if (clipboard) for (const method of ['read', 'readText', 'write', 'writeText']) Object.defineProperty(clipboard, method, { configurable: true, value: async () => { throw unavailable('系统剪贴板'); } });
  document.addEventListener('click', event => {
    const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
    if (anchor && !anchor.hasAttribute('download') && new URL(anchor.href, location.href).origin !== location.origin) { event.preventDefault(); event.stopImmediatePropagation(); unavailable('外部链接'); }
  }, true);
  window.open = () => { unavailable('外部窗口'); return null; };
  const style = document.createElement('style');
  style.textContent = '#rdesign-preview-banner{position:fixed;z-index:2147483600;left:0;right:0;top:0;min-height:40px;box-sizing:border-box;padding:8px 14px;background:#172a47;color:#f0f5ff;font:12px/1.5 system-ui;border-bottom:1px solid #587caa}#rdesign-preview-banner strong{color:#8fd8ff;margin-right:8px}#rdesign-preview-operation{position:fixed;z-index:2147483640;left:12px;right:12px;bottom:12px;padding:12px;background:#742932;color:white;font:13px/1.5 system-ui;border-radius:8px;pointer-events:none}body{padding-top:46px!important}#root{height:calc(100vh - 46px);min-height:0}#root>:first-child{max-height:calc(100vh - 46px)}@media(max-width:500px){#rdesign-preview-banner{font-size:10px;padding:5px 9px}body{padding-top:50px!important}#root{height:calc(100vh - 50px)}#root>:first-child{max-height:calc(100vh - 50px)}}';
  document.head.append(style);
  const banner = document.createElement('aside'); banner.id = 'rdesign-preview-banner'; banner.setAttribute('role', 'note');
  const label = document.createElement('strong'); label.textContent = info.name + ' · 设计预览 / 未授权';
  banner.append(label, document.createTextNode(info.notice)); banner.title = info.source.repository + ' @ ' + info.source.commit;
  const status = document.createElement('div'); status.id = 'rdesign-preview-operation'; status.setAttribute('role', 'status'); status.hidden = true;
  document.body.prepend(banner); document.body.append(status);
}
export function previewFailure(error: unknown) {
  const root = document.getElementById('root');
  if (root) { root.textContent = '预览启动失败，未执行原生操作：' + String(error); root.setAttribute('role', 'alert'); }
  console.error(error);
}
