# Web Runtime SDK

The SDK observes an authorized browser page. It supplies viewport geometry and structure; it does not capture pixels, control input, resolve filesystem paths, or write source files. The Bridge owns those operations and their permissions.

## Attach a React + TypeScript + Vite development page

Install the workspace package, then attach it once from the application entrypoint after creating the React root:

```ts
import { installRuntime } from '@rdesign/runtime-web';

if (import.meta.env.DEV) {
  installRuntime({ maxNodes: 2500 });
}
```

`maxNodes` is the only configuration option. It caps tracked DOM elements (default 2500); exceeding it is reported as `node-budget-exceeded`. Remove the development call for production, or retain the `import.meta.env.DEV` guard so Vite eliminates it from a production bundle. The monitoring fixture also supports an explicit `VITE_RDESIGN_RUNTIME=true` override for controlled testing.

Mark editable elements with unique literals when their identity should survive edits:

```tsx
<button data-rdesign-id="start-button" style={{ borderRadius: 8 }}>
  开始监控
</button>
```

The optional development plugin injects opaque IDs into otherwise unmarked intrinsic JSX elements and preserves manually assigned markers:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { rdesignSourceIds } from '@rdesign/runtime-web/vite';

export default defineConfig({ plugins: [rdesignSourceIds(), react()] });
```

`rdesignSourceIds({ root?, enabled? })` runs before JSX transforms, skips dependencies, and defaults to enabled for Vite `serve` only. `enabled: true` is an explicit build opt-in. Generated IDs hash the project-relative file, JSX source offset, and tag; no absolute source path is placed in the DOM. Copies with the same project-relative source get matching IDs. Edits that move source offsets or rename files can change generated IDs, so the Bridge rebuilds its source index and invalidates stale bindings after a source revision changes. These IDs are not a permanent identity guarantee across refactors.

Custom applications can use this SDK and plugin in their own Vite setup. The first Bridge runner currently uses a controlled React/Vite configuration rather than loading arbitrary application Vite plugins. Its built-in workflow is validated against `fixtures/react-monitor`; attaching another project requires matching the runner's current constraints. Do not assume a custom Vite configuration has been loaded merely because a page opens.

## Browser API

`installRuntime()` returns the API also exposed as `window.__RDESIGN__`:

- `snapshot()` returns `{ nodes, treeRevision, geometryRevision, viewportRevision }` using the shared protocol.
- `hitTest(x, y)` accepts viewport CSS pixel coordinates and returns an observed node or `null`.
- `health()` reports session ID, reload epoch, surface ID, status, viewport/scroll/DPR metadata, observed node count, sample duration, sample count, and degradation reasons.
- `disconnect()` releases observers, listeners, optional HMR handlers, and the browser API.

Each mount gets its own stable runtime node ID and instance key. Source markers may repeat for shared components; the Bridge must flag ambiguous/shared scope before editing. Reload keeps a tab's session/surface identity and advances its epoch via session storage. Old epoch targets cannot be reused. If session storage is unavailable, health reports the degradation and a new session identity is used.

Bounds are viewport CSS pixels and match the Bridge's viewport screenshot and input coordinates. Window and nested scroll events advance viewport versions; health additionally records window scroll position, visual viewport offset/scale, and DPR. A client must keep its own reversible canvas-to-surface transform with the versions.

Mutation and resize observers batch dirty work onto an animation frame. Unchanged `snapshot()`/`health()` reads reuse sampled DOM records; screenshots are a separate Bridge cadence. Global geometry changes still resample the tracked budget. Revisions advance only for observed payload changes, so Playwright mask/caret instrumentation does not falsely invalidate an unchanged modal frame. `sampleCount` and `lastSampleNodes` distinguish reads from actual sampling. No sustained performance benchmark or arbitrary-page latency guarantee is claimed.

Optional Vite HMR events report build errors, reconnect delay, and update progress through health (`build-failed`, `stale`, `resyncing`). The controlled Bridge workflow uses full page reloads after source changes and must report reload/build failures itself; SDK HMR hooks do not prove that a new build has applied.

## Privacy and observation limits

Structure text excludes all input/textarea/select/option contents, password values, and descendants of `[data-rdesign-private]`. Private nodes return a redacted label. Text is bounded to 240 characters per observed node. Only an explicit style allowlist is collected; no form values or arbitrary attributes enter the structure payload.

PNG privacy is separate. The SDK does not produce or redact screenshots. The Bridge masks `[data-rdesign-private]` and password inputs in its screenshot channel; other sensitive areas must also be marked private. A redacted structure payload alone does not prove a screenshot is safe.

Hidden/offscreen nodes are omitted from snapshots; the tracking budget still includes their DOM elements. Iframes, canvas/video surfaces, and unexpanded open shadow roots are reported as degraded/opaque surfaces. Closed shadow content cannot be inspected by this SDK. CSS animations can change pixels between samples; the Bridge's correlated capture/version check must reject unstable frames.

Run the focused checks with `npx vitest run tests/unit/runtime.test.ts`. These cover privacy exclusions, instrumentation filtering, opaque deterministic IDs, preservation of authored markers, and development-only injection. Browser tests separately exercise geometry, reload identity, masked modal capture, and actual interaction.
