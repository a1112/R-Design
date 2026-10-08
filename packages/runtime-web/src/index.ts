import type { ObservedNode, RuntimeTree } from '../../protocol/src/index';

export interface RuntimeHealth {
  runtimeSessionId: string; epoch: number; surfaceId: string;
  status: 'live' | 'disconnected' | 'build-failed' | 'stale' | 'resyncing'; nodeCount: number; observerCount: number;
  lastSampleAt: number; sampleDurationMs: number; sampleCount: number; lastSampleNodes: number; degraded: string[];
  viewport: { width: number; height: number; scrollX: number; scrollY: number; dpr: number; scale: number; offsetLeft: number; offsetTop: number };
}
export interface RuntimeAPI {
  snapshot(): RuntimeTree;
  hitTest(x: number, y: number): ObservedNode | null;
  health(): RuntimeHealth;
  disconnect(): void;
}
declare global { interface Window { __RDESIGN__?: RuntimeAPI } }

const styleNames = ['display', 'position', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'borderRadius', 'gap', 'gridTemplateColumns', 'padding', 'margin', 'opacity', 'textAlign', 'alignItems', 'justifyContent', 'width', 'height'] as const;
const ignoredTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);
const formTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

/** Capture/dev tooling is outside the target UI and must not advance its versions. */
export function isInstrumentationNode(node: Node): boolean {
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element) {
    if (element.tagName.startsWith('X-PW-') || element.tagName === 'VITE-ERROR-OVERLAY') return true;
    element = element.parentElement;
  }
  return false;
}

/** Read text nodes only. Form values and explicitly private subtrees never enter structure data. */
export function safeText(element: Element): string {
  if (element.closest('[data-rdesign-private]')) return '[已隐藏]';
  if (formTags.has(element.tagName)) return '';
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const child = node as Element;
    if (child.hasAttribute('data-rdesign-private') || formTags.has(child.tagName) || ignoredTags.has(child.tagName) || isInstrumentationNode(child)) return '';
    return Array.from(child.childNodes, read).join(' ');
  };
  return read(element).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function roleFor(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  return ({ BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell', NAV: 'navigation', MAIN: 'main', DIALOG: 'dialog' } as Record<string, string>)[element.tagName] ?? 'generic';
}

export function installRuntime(options: { maxNodes?: number } = {}): RuntimeAPI {
  if (window.__RDESIGN__) return window.__RDESIGN__;
  const degraded = new Set<string>();
  let runtimeSessionId: string = crypto.randomUUID(), surfaceId: string = crypto.randomUUID(), epoch = 1;
  try {
    const previous = JSON.parse(sessionStorage.getItem('rdesign.runtime') ?? 'null') as { runtimeSessionId: string; surfaceId: string; epoch: number } | null;
    if (previous && typeof previous.runtimeSessionId === 'string' && typeof previous.surfaceId === 'string' && Number.isInteger(previous.epoch) && previous.epoch >= 0) {
      runtimeSessionId = previous.runtimeSessionId; surfaceId = previous.surfaceId; epoch = previous.epoch + 1;
    }
    sessionStorage.setItem('rdesign.runtime', JSON.stringify({ runtimeSessionId, surfaceId, epoch }));
  } catch { degraded.add('session-storage-unavailable'); }
  const maxNodes = options.maxNodes ?? 2500;
  const identities = new WeakMap<Element, string>();
  const elements = new Map<string, Element>();
  const records = new Map<string, ObservedNode>();
  const dirty = new Set<Element>();
  let nextIdentity = 1, treeRevision = 1, geometryRevision = 1, viewportRevision = 1;
  let treeDirty = true, geometryDirty = true, allDirty = true, scheduled = 0, connected = true;
  let lastSampleAt = 0, sampleDurationMs = 0, sampleCount = 0, lastSampleNodes = 0;
  let runtimeStatus: RuntimeHealth['status'] = 'live';

  function identity(element: Element) {
    let id = identities.get(element);
    if (!id) { id = `node-${epoch}-${nextIdentity++}`; identities.set(element, id); }
    return id;
  }
  function mark(element: Element | null, descendants = false) {
    if (!element || isInstrumentationNode(element)) return;
    dirty.add(element);
    if (descendants) for (const child of element.querySelectorAll('*')) if (!isInstrumentationNode(child)) dirty.add(child);
    let parent = element.parentElement;
    while (parent && parent !== document.documentElement) { dirty.add(parent); parent = parent.parentElement; }
  }
  function register(root: Element) {
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (ignoredTags.has(element.tagName) || isInstrumentationNode(element)) continue;
      const id = identity(element);
      if (!elements.has(id)) {
        if (elements.size >= maxNodes) { degraded.add('node-budget-exceeded'); break; }
        elements.set(id, element); resizeObserver?.observe(element);
      }
      dirty.add(element);
      if (['IFRAME', 'CANVAS', 'VIDEO'].includes(element.tagName)) degraded.add(`${element.tagName.toLowerCase()}-opaque-surface`);
      if (element.shadowRoot) degraded.add('shadow-dom-not-expanded');
    }
  }
  function viewport() {
    const visual = window.visualViewport;
    return { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio, scale: visual?.scale ?? 1, offsetLeft: visual?.offsetLeft ?? 0, offsetTop: visual?.offsetTop ?? 0 };
  }
  function sample(element: Element): ObservedNode | null {
    if (!element.isConnected || ignoredTags.has(element.tagName) || isInstrumentationNode(element)) return null;
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    if (computed.display === 'none' || computed.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
    const styles: Record<string, string> = {};
    for (const name of styleNames) styles[name] = computed[name];
    const id = identity(element);
    let parent = element.parentElement;
    while (parent && !elements.has(identity(parent))) parent = parent.parentElement;
    const sourceNodeId = element.getAttribute('data-rdesign-id') ?? undefined;
    return {
      runtimeNodeId: id, sourceNodeId, instanceKey: `${sourceNodeId ?? 'unmapped'}:${id}`,
      parentId: parent ? identity(parent) : undefined, tag: element.tagName.toLowerCase(), role: roleFor(element),
      text: safeText(element), bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, styles,
    };
  }
  function flush() {
    if (!connected) return;
    if (scheduled) { cancelAnimationFrame(scheduled); scheduled = 0; }
    if (!treeDirty && !geometryDirty && !dirty.size && !allDirty) return;
    const started = performance.now();
    const previous = new Map(records);
    for (const [id, element] of elements) {
      if (!element.isConnected) { elements.delete(id); records.delete(id); resizeObserver?.unobserve(element); }
    }
    const candidates = allDirty || geometryDirty ? elements.values() : dirty.values();
    lastSampleNodes = 0;
    for (const element of candidates) {
      const id = identity(element);
      if (!elements.has(id)) continue;
      lastSampleNodes++;
      const record = sample(element);
      if (record) records.set(id, record); else records.delete(id);
    }
    // A visible child may have an invisible parent. Retain only references present in this snapshot.
    for (const [id, record] of records) if (record.parentId && !records.has(record.parentId)) records.set(id, { ...record, parentId: undefined });
    let observedTreeChanged = previous.size !== records.size;
    let observedGeometryChanged = observedTreeChanged;
    for (const [id, record] of records) {
      const old = previous.get(id);
      if (!old) { observedTreeChanged = true; observedGeometryChanged = true; continue; }
      if (old.text !== record.text || old.sourceNodeId !== record.sourceNodeId || old.parentId !== record.parentId || old.tag !== record.tag || old.role !== record.role || styleNames.some(name => old.styles[name] !== record.styles[name])) observedTreeChanged = true;
      if (old.bounds.x !== record.bounds.x || old.bounds.y !== record.bounds.y || old.bounds.w !== record.bounds.w || old.bounds.h !== record.bounds.h) observedGeometryChanged = true;
    }
    // Tooling can temporarily hide carets via inline styles during screenshots.
    // Only changes in the sampled UI payload invalidate target versions.
    if (observedTreeChanged) treeRevision++;
    if (observedGeometryChanged) geometryRevision++;
    dirty.clear(); treeDirty = false; geometryDirty = false; allDirty = false;
    sampleDurationMs = performance.now() - started; lastSampleAt = Date.now(); sampleCount++;
  }
  function schedule() { if (connected && !scheduled) scheduled = requestAnimationFrame(flush); }
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    for (const entry of entries) mark(entry.target);
    geometryDirty = true; schedule();
  });
  if (!resizeObserver) degraded.add('resize-observer-unavailable');
  const mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      if (isInstrumentationNode(mutation.target)) continue;
      if (mutation.type === 'childList') {
        const added = Array.from(mutation.addedNodes).filter(node => !isInstrumentationNode(node));
        const removed = Array.from(mutation.removedNodes).filter(node => !isInstrumentationNode(node));
        if (!added.length && !removed.length) continue;
        for (const node of added) if (node instanceof Element) register(node);
        treeDirty = true; geometryDirty = true;
      } else if (mutation.type === 'characterData') { treeDirty = true; geometryDirty = true; }
      else {
        treeDirty = true; geometryDirty = true;
        if (target?.tagName === 'STYLE' || target?.tagName === 'LINK') allDirty = true;
      }
      mark(target, mutation.type === 'attributes');
    }
    if (treeDirty || geometryDirty || dirty.size || allDirty) schedule();
  });
  function onViewport() { viewportRevision++; geometryDirty = true; schedule(); }
  function onStyle(event?: Event) { if (event?.target instanceof Node && isInstrumentationNode(event.target)) return; allDirty = true; geometryDirty = true; schedule(); }
  const styleEvents = ['focusin', 'focusout', 'pointerover', 'pointerout', 'transitionend', 'animationend'] as const;
  mutationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'role', 'data-rdesign-id', 'data-rdesign-private', 'open', 'disabled', 'href'] });
  window.addEventListener('resize', onViewport);
  document.addEventListener('scroll', onViewport, true);
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);
  for (const event of styleEvents) document.addEventListener(event, onStyle, true);
  document.fonts?.addEventListener('loadingdone', onStyle);
  // Optional development HMR reporting. Controlled Bridge previews use full reloads.
  const hot = import.meta.hot;
  const onBuildError = () => { runtimeStatus = 'build-failed'; };
  const onBeforeUpdate = () => { runtimeStatus = 'resyncing'; };
  const onAfterUpdate = () => { runtimeStatus = 'live'; onStyle(); };
  const onConnectionLost = () => { runtimeStatus = 'stale'; };
  hot?.on('vite:error', onBuildError);
  hot?.on('vite:beforeUpdate', onBeforeUpdate);
  hot?.on('vite:afterUpdate', onAfterUpdate);
  hot?.on('vite:beforeFullReload', onBeforeUpdate);
  hot?.on('vite:ws:disconnect', onConnectionLost);
  register(document.body); flush();
  const api: RuntimeAPI = {
    snapshot() { flush(); return { nodes: Array.from(records.values(), record => ({ ...record, bounds: { ...record.bounds }, styles: { ...record.styles } })), treeRevision, geometryRevision, viewportRevision }; },
    hitTest(x, y) {
      flush();
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
      let element: Element | null = document.elementFromPoint(x, y);
      while (element) { const record = records.get(identity(element)); if (record) return { ...record, bounds: { ...record.bounds }, styles: { ...record.styles } }; element = element.parentElement; }
      return null;
    },
    health() { flush(); return { runtimeSessionId, epoch, surfaceId, status: connected ? runtimeStatus : 'disconnected', nodeCount: records.size, observerCount: elements.size, lastSampleAt, sampleDurationMs, sampleCount, lastSampleNodes, degraded: [...degraded], viewport: viewport() }; },
    disconnect() {
      connected = false; mutationObserver.disconnect(); resizeObserver?.disconnect(); if (scheduled) cancelAnimationFrame(scheduled);
      window.removeEventListener('resize', onViewport); document.removeEventListener('scroll', onViewport, true);
      window.visualViewport?.removeEventListener('resize', onViewport); window.visualViewport?.removeEventListener('scroll', onViewport);
      for (const event of styleEvents) document.removeEventListener(event, onStyle, true);
      document.fonts?.removeEventListener('loadingdone', onStyle); delete window.__RDESIGN__;
      hot?.off('vite:error', onBuildError); hot?.off('vite:beforeUpdate', onBeforeUpdate); hot?.off('vite:afterUpdate', onAfterUpdate);
      hot?.off('vite:beforeFullReload', onBeforeUpdate); hot?.off('vite:ws:disconnect', onConnectionLost);
    },
  };
  window.__RDESIGN__ = api;
  return api;
}
