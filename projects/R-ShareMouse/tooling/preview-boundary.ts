/** Explicit, offline design boundary. No native globals or successful backend replies. */
export const designPreview = true;
export const previewDiagnostics = { blocked: [] as string[] };

function unavailable(kind: string): never {
  previewDiagnostics.blocked.push(kind);
  throw new DOMException(`纯设计预览：${kind} 不可用；未连接真实后端或原生服务`, 'NotSupportedError');
}

export function installPreviewBoundary(assetUrls: Record<string, string> = {}) {
  const realFetch = window.fetch.bind(window);
  const resolveAsset = (value: string) => {
    const url = new URL(value, window.location.href);
    return assetUrls[url.pathname] ?? value;
  };
  window.fetch = async (input, init) => {
    const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(value, window.location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' && assetUrls[url.pathname]) return realFetch(assetUrls[url.pathname]);
    if (method === 'GET' && (url.protocol === 'blob:' || url.protocol === 'data:')) return realFetch(input, init);
    if (method === 'GET' && url.origin === window.location.origin && /^\/(?:src|@vite|@id|node_modules)\//.test(url.pathname)) return realFetch(input, init);
    return unavailable(`网络请求 ${method} ${url.pathname}`);
  };
  // React sets image URLs through setAttribute. Reconstructed large assets retain exact bytes.
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    return setAttribute.call(this, name, this instanceof HTMLImageElement && name.toLowerCase() === 'src' ? resolveAsset(value) : value);
  };
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value: string) { src.set!.call(this, resolveAsset(value)); } });
  class UnavailableWebSocket { constructor() { unavailable('WebSocket/daemon 连接'); } }
  Object.defineProperty(window, 'WebSocket', { configurable: true, value: UnavailableWebSocket });
  class UnavailableEventSource { constructor() { unavailable('EventSource 后端事件'); } }
  Object.defineProperty(window, 'EventSource', { configurable: true, value: UnavailableEventSource });
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => unavailable('摄像头/麦克风');
  Object.assign(window, { __RDESIGN_DESIGN_PREVIEW__: { mode: 'offline-design', diagnostics: previewDiagnostics } });
}
