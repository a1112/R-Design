import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, frozenSha } from './frozen-host.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const folder = path.join(repoRoot, 'projects/R-ShareMouse');
const config = JSON.parse(await readFile(path.join(folder, 'official-packing.config.json'), 'utf8'));
assert.equal(config.repositoryUrl, 'https://github.com/a1112/R-ShareMouse');
const prepared = path.resolve(repoRoot, config.preparedDirectory);
assert(prepared.startsWith(path.join(repoRoot, '.rdesign/desktop-official-prepared') + path.sep), 'Only an owned prepared design copy may be changed');
const source = path.resolve(repoRoot, config.repositoryRoot);
assert.equal(execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), config.commit);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim(), '');
const ledgerPath = path.join(prepared, config.provenanceFile);
const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
assert(!ledger.responsivePreviewAdapter, 'This adapter must be applied once to a fresh prepared copy');
const changed = [];
async function change(file, transform) {
  const before = await readFile(path.join(prepared, file), 'utf8');
  const after = transform(before);
  assert.notEqual(before, after, 'Adapter must make an explicit change');
  await writeFile(path.join(prepared, file), after);
  const original = ledger.stagedFiles.find(item => item.path === file);
  changed.push({ path: file, ...(original ? { originalSourcePath: original.sourcePath, originalSourceSha256: original.sourceSha256 } : { sourceKind: 'generated design boundary' }), beforeSha256: digest(before), afterSha256: digest(after) });
}
function once(text, before, after) { assert.equal(text.split(before).length - 1, 1, `Unique pinned-source anchor required: ${before.slice(0, 80)}`); return text.replace(before, after); }

await change('src/app/App.tsx', text => {
  for (const [before, after] of [
    ['className="rshare-titlebar flex shrink-0 items-center"', 'data-rdesign-responsive="titlebar" className="rshare-titlebar flex shrink-0 items-center"'],
    ['className="flex shrink-0 items-center"\n          style={{ gap: headerMetrics.navGap }}', 'data-rdesign-responsive="navigation" className="flex shrink-0 items-center"\n          style={{ gap: headerMetrics.navGap }}'],
    ['className="flex shrink-0 items-center"\n          style={{ gap: headerMetrics.actionGap }}', 'data-rdesign-responsive="actions" className="flex shrink-0 items-center"\n          style={{ gap: headerMetrics.actionGap }}'],
    ['className="ml-2 flex h-full shrink-0 items-center"', 'data-rdesign-responsive="window-controls" className="ml-2 flex h-full shrink-0 items-center"'],
    ['className="mx-4 mt-3 px-4 py-3 text-sm"', 'data-rdesign-responsive="error-notice" className="mx-4 mt-3 px-4 py-3 text-sm"'],
    ['className="flex h-8 shrink-0 items-center gap-3 px-4 text-xs"', 'data-rdesign-responsive="status-footer" className="flex h-8 shrink-0 items-center gap-3 px-4 text-xs"'],
    ['className="rshare-scroll flex shrink-0 flex-col gap-2 overflow-auto p-3 lg:w-[300px]"', 'data-rdesign-responsive="settings-navigation" className="rshare-scroll flex shrink-0 flex-col gap-2 overflow-auto p-3 lg:w-[300px]"'],
    ['className="rshare-scroll min-h-0 flex-1 overflow-auto p-4"', 'data-rdesign-responsive="settings-content" className="rshare-scroll min-h-0 flex-1 overflow-auto p-4"'],
    ['key={section.key}\n              type="button"', 'key={section.key}\n              data-rdesign-id={`rshare-settings-${section.key}`} type="button"'],
    ['key={option.key}\n              type="button"\n              className="rounded-md px-4 py-2 text-sm transition"', 'key={option.key}\n              data-rdesign-id={`rshare-theme-${option.key}`} aria-pressed={themeMode === option.key} type="button"\n              className="rounded-md px-4 py-2 text-sm transition"'],
  ]) text = once(text, before, after);
  return text;
});

await change('src/app/components/MonitorManager.tsx', text => {
  for (const [before, after] of [
    ['className="w-full h-full flex flex-col overflow-hidden"', 'data-rdesign-responsive="monitor-layout" className="w-full h-full flex flex-col overflow-hidden"'],
    ['className="h-[36px] flex items-center px-3 gap-2.5 shrink-0"', 'data-rdesign-responsive="layout-toolbar" className="h-[36px] flex items-center px-3 gap-2.5 shrink-0"'],
    ['className="flex items-center gap-0.5 ml-2"', 'data-rdesign-responsive="layout-zoom" className="flex items-center gap-0.5 ml-2"'],
    ['className="flex-1 flex min-h-0"', 'data-rdesign-responsive="layout-content" className="flex-1 flex min-h-0"'],
    ['className="shrink-0 flex flex-col overflow-hidden"\n          style={{\n            width: sidebarOpen ? 240 : 0,', 'data-rdesign-responsive="layout-sidebar" data-rdesign-sidebar-open={sidebarOpen ? "true" : "false"} className="shrink-0 flex flex-col overflow-hidden"\n          style={{\n            width: sidebarOpen ? 240 : 0,'],
    ['className="w-[240px] flex flex-col h-full"', 'data-rdesign-responsive="layout-sidebar-content" className="w-[240px] flex flex-col h-full"'],
    ['className="flex-1 relative overflow-hidden"', 'data-rdesign-responsive="layout-canvas" className="flex-1 relative overflow-hidden"'],
  ]) text = once(text, before, after);
  const fit = `
  // Design-preview adapter: fit the selected display and its controls only on narrow geometry changes.
  // Uses the original zoom/pan state so existing hit testing, dragging and unavailable IPC stay intact.
  const fitNarrowPreviewCanvas = useCallback(() => {
    if (!window.matchMedia("(max-width: 640px)").matches || !canvasRef.current) return false;
    const enabled = monitorsRef.current.filter(monitor => monitor.enabled);
    if (!enabled.length) return false;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const left = Math.min(...enabled.map(monitor => monitor.x));
    const top = Math.min(...enabled.map(monitor => monitor.y));
    const right = Math.max(...enabled.map(monitor => monitor.x + monitor.w));
    const bottom = Math.max(...enabled.map(monitor => monitor.y + monitor.h));
    const scale = Math.max(0.3, Math.min(1, (rect.width - 48) / Math.max(1, right - left), (rect.height - 48) / Math.max(1, bottom - top)));
    setZoom(scale);
    setPanOffset({ x: rect.width / (2 * scale) - (left + right) / 2, y: rect.height / (2 * scale) - (top + bottom) / 2 });
    return true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let previousSize = "";
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const size = rect.width + ":" + rect.height;
      if (size === previousSize) return;
      previousSize = size;
      fitNarrowPreviewCanvas();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    const media = window.matchMedia("(max-width: 640px)");
    const changed = () => { previousSize = ""; fit(); };
    media.addEventListener("change", changed);
    fit();
    return () => { observer.disconnect(); media.removeEventListener("change", changed); };
  }, [fitNarrowPreviewCanvas]);
`;
  text = once(text, '  const isDark = externalIsDark ?? internalIsDark;', fit + '\n  const isDark = externalIsDark ?? internalIsDark;');
  const toolbarAnchor = '<ToolbarBtn theme={t} onClick=';
  assert.equal(text.split(toolbarAnchor).length - 1, 3);
  for (const title of ['缩小画布', '放大画布', '重置画布']) text = text.replace(toolbarAnchor, `<ToolbarBtn title="${title}" theme={t} onClick=`);
  text = once(text, 'onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}', 'onClick={() => { if (!fitNarrowPreviewCanvas()) { setZoom(1); setPanOffset({ x: 0, y: 0 }); } }}');
  text = once(text, 'function ToolbarBtn({ children, theme, onClick }: { children: React.ReactNode; theme: Theme; onClick: () => void })', 'function ToolbarBtn({ children, theme, onClick, title }: { children: React.ReactNode; theme: Theme; onClick: () => void; title: string })');
  const buttonStart = text.indexOf('function ToolbarBtn(');
  text = text.slice(0, buttonStart) + once(text.slice(buttonStart), '<button\n      className=', '<button title={title}\n      className=');
  return text;
});

await change('src/main.tsx', text => {
  text = once(text, "import './rdesignBoot';", "import './rdesignBoot';\nimport './rdesignResponsive.css';");
  return once(text, "const statusRoot = document.createElement('div');", "const statusRoot = document.createElement('div');\nstatusRoot.setAttribute('data-rdesign-preview-status-root', 'true');");
});
const css = await readFile(path.join(folder, 'preview-adapter/responsive.css'));
await writeFile(path.join(prepared, 'src/rdesignResponsive.css'), css);
changed.push({ path: 'src/rdesignResponsive.css', beforeSha256: null, afterSha256: digest(css), kind: 'new authored design-preview CSS' });
const provenancePath = path.join(prepared, 'src/rdesignProvenance.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
provenance.responsivePreviewAdapter = { schemaVersion: 1, breakpoint: 640, files: changed, behavior: 'Narrow titlebar wrap, scrollable settings navigation, stacked layout sidebar, original-state canvas fit and accessible zoom controls; no backend/native simulation' };
await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
for (const item of [...ledger.stagedFiles, ...ledger.generatedFiles]) if (item.path !== config.provenanceFile) item.sha256 = digest(await readFile(path.join(prepared, item.path)));
ledger.generatedFiles.push({ path: 'src/rdesignResponsive.css', sha256: digest(css), kind: 'authored narrow design-preview adapter; verified separately' });
ledger.responsivePreviewAdapter = { schemaVersion: 1, testedHostSha: frozenSha, originalSourceSha: config.commit, breakpoint: 640, files: changed, upstreamSourceModified: false, desktopLayoutChanged: false, verification: 'Pending actual source build, narrow control reachability, overflow and interactions' };
await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
for (const scene of config.scenarios) {
  if (!scene.dependencies.includes('src/rdesignResponsive.css')) scene.dependencies.push('src/rdesignResponsive.css');
  if (scene.id === 'settings-desktop') { scene.steps = [{ action: 'click', target: 'rshare-settings-appearance' }]; scene.readySelector = '[data-rdesign-id="rshare-theme-light"]'; }
}
config.scenarios.push({ id: 'settings-narrow', name: '设置 · 外观窄屏', route: '/#settings', viewport: { width: 390, height: 844 }, steps: [{ action: 'click', target: 'rshare-settings-appearance' }], readySelector: '[data-rdesign-id="rshare-theme-light"]', dependencies: ['src/app/App.tsx', 'src/rdesignResponsive.css'], status: 'unverified' });
config.limitations = config.limitations.map(value => value.includes('Narrow viewport records') ? 'An explicit design-preview adapter makes narrow controls reachable; desktop source is preserved. Native/backend functionality remains unavailable.' : value);
await writeFile(path.join(folder, 'official-packing.config.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(path.join(folder, 'responsive-adaptation-summary.json'), JSON.stringify({ ...ledger.responsivePreviewAdapter, changedFiles: changed.length, preparedBaselineWasByteIdentical: true, actualAcceptance: 'pending; see subsequent official-validation-summary.json' }, null, 2) + '\n');
const preparationFile = path.join(folder, 'official-preparation-summary.json');
const preparation = JSON.parse(await readFile(preparationFile, 'utf8'));
preparation.subsequentResponsiveAdapter = 'projects/R-ShareMouse/responsive-adaptation-summary.json';
preparation.postCopyModifiedPreparedFiles = changed;
await writeFile(preparationFile, JSON.stringify(preparation, null, 2) + '\n');
console.log(JSON.stringify({ name: 'R-ShareMouse', modifiedPreparedFiles: changed.length, originalSourceModified: false, narrowSceneAdded: 'settings-narrow' }));
