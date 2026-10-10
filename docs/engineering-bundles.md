# Existing frontend engineering bundles

The engineering CLI produces the same version 1 portable format used by the project home importer. It reads **Git objects at an exact commit**, including when the checkout has local edits. It never installs dependencies, executes the source project's scripts/configuration, starts its backend, or changes its working tree.

```sh
npm ci --ignore-scripts
npm run engineering -- generate /path/to/config.json /path/to/project.rdesign.json
npm run engineering -- preflight /path/to/project.rdesign.json
```

The output uses an exclusive create (`wx`): generating again requires a new output name. Paths are interpreted relative to the current directory; use absolute paths for `repositoryRoot` and output. Start from [the config example](../examples/engineering-config.example.json) and replace its placeholders and resource/edit rules with files that actually exist at the source commit. `copies.from` is repository-relative; all other source/edit/relocation paths are frontend-relative. Edits require exactly one literal match by default, or an explicit `expectedMatches` count. A stale source anchor fails instead of silently producing a partial adapter.

## Supported source scope

The initial generator supports React 19 frontends with `index.html`, `package.json` and `src/main.tsx`. It selects committed application source and static resources under `src`, `assets` and `public`. It rejects application symlinks, private paths, credentials, executable configs, unsupported dependencies, oversized files and colliding paths. It rebuilds the package scripts, adds the observation SDK once after the root entry, and records source Git blob identities and explicit adaptations in `src/rdesign-origin.json`.

Design stylesheet names such as `tokens.css`, `design-tokens.css`, `theme-tokens.css` and `macos-tokens.css` remain application resources. This narrow exception does not permit token JSON/data files or credential files; text credential checks still apply to the stylesheet contents.

The host provides React/React DOM, the SDK, and these reviewed browser packages at fixed versions:

| Package | Version |
| --- | --- |
| lucide-react | 0.468.0 |
| three | 0.180.0 |
| @tauri-apps/api | 2.8.0 |
| react-markdown | 9.0.3 |
| remark-gfm | 4.0.1 |
| i18next | 25.10.0 |
| react-i18next | 16.3.5 |
| react-router-dom | 7.9.3 |
| uplot | 1.6.32 |
| zod | 3.25.76 (including `zod/v4`) |

File-browser controls also support these exact versions through the same host resolver for live and candidate previews:

| Package | Version |
| --- | --- |
| @radix-ui/react-dialog | 1.1.23 |
| @radix-ui/react-dropdown-menu | 2.1.24 |
| @radix-ui/react-select | 2.3.7 |
| @radix-ui/react-slot | 1.3.3 |
| @radix-ui/react-tooltip | 1.2.8 |
| class-variance-authority | 0.7.1 |
| date-fns | 3.6.0 |

Version ranges, other versions and npm install aliases for these packages remain rejected. A scoped host override makes Tooltip 1.2.8 use the same DismissableLayer 1.1.19 instance as Dialog, Select and the menus; Tooltip's original 1.1.11 copy would otherwise let Escape dismiss an outer dialog before its tooltip. The synthetic `tests/protocol/file-runtime.test.ts` fixture exercises dialog and dropdown portals, select changes, slot behavior, tooltip visibility and date formatting after official generation/import/build. Three nested Dialog/Tooltip cycles assert that the first Escape closes only the tooltip, the second closes the dialog, focus returns to its trigger, body pointer handling is restored and an outside action remains clickable. The fixture also verifies main and dialog candidate scenes, applies a unique static text change, and restores that text through semantic revert. This establishes browser-control compatibility; a file manager's filesystem, remote connections and native operations require separate application evidence.

These packages are preserved when importing and resolved through the host for both live and candidate previews, including export subpaths such as `three/addons/...`. A browser import of the Tauri API does not provide native IPC. Other dependencies or versions require an explicit host compatibility change and execution evidence. Workspaces, `file:` dependencies, aliases, JSX-only entry points, React 18, Vue and Next are not automatically adapted. Core tool dependency declarations use the existing importer policy; the controlled host still selects its React/tool versions.

Font-oriented browser previews additionally register `react-dnd` 16.0.1, `react-dnd-html5-backend` 16.0.1 and `react-syntax-highlighter` 16.1.2. Formal prepared packages and portable imports require those exact versions; ranges and install aliases are rejected. Source generation retains its existing normalization and emits controlled exact versions without installing or resolving the source package. The synthetic `tests/protocol/font-runtime.test.ts` fixture exercises an actual HTML5 drag/drop state transition, Prism's rendered inline keyword color, theme CSS variables, official pack/import/build, and a static text candidate across desktop and narrow scenes with apply and semantic revert. These checks establish controlled browser compatibility; actual font loading, installation, analysis and external services require separate application evidence.

All Git object reads disable replacement objects without changing repository settings, so provenance refers to the requested commit's actual tree and blobs. Registered browser dependencies used by value imports, re-exports or literal dynamic imports are retained even when declared in optional or development dependencies; unused build tooling is not copied. CSS imports such as `@import "theme.css"` resolve as local stylesheet resources.

Dependency provenance contains only the controlled runtime dependency versions used by the generated package. Original dependency specifications and unused declarations are omitted, including core tooling declarations that the host replaces. Required browser packages must match the reviewed versions; URL/Git specifications fail without echoing the original specification. The original package's committed Git blob identity remains available for provenance without exporting its dependency URLs or scripts.

Controlled previews explicitly set the existing `VITE_RDESIGN_RUNTIME=true` flag, so a preceding build or a production Node environment cannot silently disable the observation SDK. Runtime port `0` allocates a temporary loopback port rather than occupying Vite's default `5173`; explicitly requested preview ports remain strict.

`publicDir` remains disabled. Move public resources into `src/assets` through explicit relocation rules, then update CSS/HTML/code references. Keeping resources under `src` also includes them in `codeHash` and candidate conflict checks. Tailwind source directives need an explicit compiled CSS adapter; the generator does not execute the source project's build tooling or drop its stylesheet.

Root `assets/` and `public/` files also participate in code revisions and candidate file guards. This does not enable serving `publicDir` or grant an agent permission to edit resources outside its approved patches; it prevents rendered assets from changing behind previously verified evidence.

## Format and evidence

### Explicit prepared adapters

`pack-prepared` accepts an already prepared frontend and a source ledger. It never runs preparation scripts, infers a replacement entry, upgrades React, or installs packages. SDK lifecycle, stylesheet compilation, preview providers and dependency adaptations remain explicit adapter decisions with separate execution evidence.

```sh
npm run engineering -- pack-prepared /path/to/prepared-config.json /path/to/project.rdesign.json
```

The configuration uses the same `repositoryRoot`, credential-free `repositoryUrl`, exact `commit`, `name`, `scenarios` and `limitations` fields as generation, plus absolute `preparedDirectory` and its relative `provenanceFile`. The ledger has this shape:

```json
{
  "schemaVersion": 1,
  "source": { "repository": "owner/repository", "commit": "40-character-source-SHA" },
  "stagedFiles": [{ "sourcePath": "original/file.tsx", "path": "src/upstream/file.tsx", "sourceSha256": "64-character-hex", "sha256": "64-character-hex" }],
  "splitResources": [{ "file": "original/large.png", "bytes": 1597505, "sha256": "64-character-hex", "chunks": ["src/assets/chunk-0.json", "src/assets/chunk-1.json"] }]
}
```

Each staged record compares original bytes from the pinned Git commit with the recorded original SHA256 and captured adapted bytes with the staged SHA256. Split resources use JSON `{ "base64": "canonical-base64" }` chunks in original order. The packer verifies the reconstructed byte length and SHA256 against the original Git blob; it preserves large resources without re-encoding. An empty `splitResources` array is valid.

Git paths use NUL-separated records, so Unicode original filenames work without changing `core.quotePath`. Split resources are limited to the same supported image/font extensions and content headers as portable binary assets. Reconstructed bytes also receive the existing private-content check before output; base64 does not exempt text or binary assets from that check. A synthetic private marker is rejected identically when supplied directly or through resource chunks, without echoing its contents.

The prepared tree passes the same path, file, dependency and bundle limits as import. The packer seals its captured bytes, records every prepared file hash in reserved `src/rdesign-prepared-origin.json`, and runs the existing v1 validator/preflight. It does not prove that the ledger lists every original frontend file or that an adapter preserves application semantics. Those require separate source review, resource coverage, browser scenes, business assertions and candidate tests. Private source text, authenticated dependency URLs and production data must not be placed in public recipes or bundles.

### Explicit unchanged theme module

An optional `themeStyleModule` profile admits one original React frontend color module whose filename would otherwise be protected. It applies only during prepared provenance verification; generic file capture and portable import retain their existing private-path policy.

```json
{
  "themeStyleModule": {
    "frontendDirectory": "web",
    "sourceSha256": "64-character-lowercase-hex-SHA256"
  }
}
```

`frontendDirectory` is a canonical repository-relative directory (`.` is allowed). Its committed `package.json` must declare React and React DOM. Exactly one staged ledger record must have `sourceRole: "theme-style-module"`, original `sourcePath: "web/src/theme/tokens.ts"`, prepared `path: "src/theme/design-style.ts"`, and identical original, prepared and configured SHA256 values. The prepared module must preserve the original bytes. The original must be a regular Git blob at the exact source commit, at most 1 MiB, with no private ancestor. Renaming a different private file, modifying the module, supplying an unused or duplicate profile, or admitting it as a split resource fails. Nothing automatically upgrades the source frontend or creates this adapter.

The packer parses TypeScript without running the module. The `theme-color-css-v1` proof accepts the named `getThemePresetById` import from `./registry`, restricted type imports from `./types`, bounded local arrow helpers, the exact exports `clamp`, `isHexColor`, `buildThemeTokens` and `applyThemeToDOM`, and restricted color/string calculations. DOM statements must match the fixed document-root theme class/attribute operations and a bounded table of unique literal CSS custom properties applied through `root.style.setProperty`. Unknown globals, network/storage/native imports, dynamic imports, top-level execution, computed property access, prototype capabilities, altered DOM targets and credential content are rejected. Raw and decoded string content both receive private-content checks. The proof and original/prepared paths are recorded in reserved provenance metadata.

Type-only import bindings may appear in TypeScript type positions, but cannot supply runtime values. The proof checks the binding of each reference; a real local runtime parameter may share a type name without becoming a type-only import. Synthetic regressions cover all four allowed type names at the proof and official prepared-pack entry, and valid annotations continue through official import, live/candidate builds and actual theme calls. Build success alone cannot establish this boundary because transpilation erases type imports.

This is a narrow structural admission rule, not a JavaScript sandbox or proof of the imported registry, helper termination, complete frontend coverage, or application behavior. Review the original module and its dependency closure separately, preserve the recorded source commit and hashes, and attach actual application scenes, browser state assertions and candidate evidence. The synthetic tests cover dirty source worktrees and Git replacement refs, exact byte/hash/path/role gates, protected generic capture/import, symlinks, size limits, private content and capability rejection without publishing private application source.

```text
{ format: "rdesign-project", schemaVersion: 1,
  manifest, document: {schemaVersion: 1, project, changes},
  sourceFiles: [{path, content, sha256, encoding?: "utf8" | "base64"}], checksum }
```

Each file digest covers UTF-8 bytes or decoded base64 bytes. The bundle digest covers `JSON.stringify(payload)` with `checksum` omitted, preserving property order; it is not a digest of pretty-printed bytes. Limits remain 1 MiB per file, 1,000 source files and 24 MiB of serialized payload. The importer creates a new project identity, reuses controlled executable metadata, marks scenarios unverified and makes imported change history read-only.

Imported scenarios with historical snapshots display “待重新验证”. Their images remain historical evidence; a new live instance must recapture the scene before it is current.

Conditional targets can retain their same-origin route, viewport and registered scene steps through verification and source reload. A failed automatic reload keeps its recovery recipe for the next capture and remains unavailable until the recipe succeeds. Explicit scene selection clears the previous recipe and refreshes source before entering the selected scene, so a frame and its remembered steps describe the same state. Restoration and scene capture check the authorized origin immediately after navigation and before/after each step; a redirect stops subsequent fills and clicks. This context never captures arbitrary application state, form values, browser storage or cookies. Candidate revert checks controlled property semantics, not byte-identical source formatting.

Preflight shares the importer's integrity, path and dependency checks, then checks source imports, common CSS resource references, standard entry/SDK references and registered scene dependencies. Its report is **structural evidence**. It does not prove browser execution, business transitions, dynamically computed assets, backend connectivity or native capabilities.

For delivery, import into an isolated data root, execute desktop and narrow scenes, assert the actual business state transitions, capture real runtime frames, verify exact/ambiguous source mappings, and run a candidate edit when applicable. Report original limitations and unavailable services explicitly. Use separate synthetic fixtures for unavailable backends; never package production credentials or private business data. Keep private source bundles in a private delivery location, rather than adding them to a public host repository.

## Pinned browser editor dependencies

The editor profile adds Monaco `0.57.0`, Zustand `5.0.15`, seven Radix controls (alert-dialog `1.1.23`, checkbox `1.3.11`, label `2.1.15`, radio-group `1.4.7`, scroll-area `1.2.18`, switch `1.3.7`, tabs `1.1.21`) and the separate `lucide-react-v116` import name for icons `1.16.0`. `projectPackage`, prepared packages and portable imports require these exact versions; ranges and npm install aliases are rejected at those boundaries. Actual Git source generation retains its existing normalization of a matching registered version declared as `V`, `^V` or `~V`, and emits the controlled exact version. A prepared adapter must explicitly translate imports requiring a separate package profile. Only the host uses the npm install alias. Existing icon `0.468.0`/`0.487.0` imports and scoped overrides stay intact. Importing an engineering bundle does not install dependencies.

Monaco `editor/editor.api` and the five `editor/editor.worker?worker`, `language/css/css.worker?worker`, `language/html/html.worker?worker`, `language/json/json.worker?worker` and `language/typescript/ts.worker?worker` imports use the existing host resolver and Vite worker transform. These are browser workers; they do not grant native, terminal, filesystem or model access. An API-only editor import does not establish language registration. A frontend must include the appropriate pinned language/contribution entry (for example `editor/editor.main`) to enable its intended editing features. Package recognition in structural preflight does not prove an arbitrary subpath exists or a worker runs.

The synthetic editor regression uses official prepared pack, two independent imports and live/candidate directories without local `node_modules`. Initial, candidate, applied and reverted runtimes each wait for worker results, reject diagnostic errors, and check real keyboard input, read-only behavior, TypeScript tokenization/2322, JSON/CSS/HTML results, an editor-worker diff and all five workers' sent/received/error state. It also checks all seven controls, Zustand updates and the icon alias. The existing canonical filesystem boundary remains enabled, including an actual rejection of a synthetic file outside its allowed roots. Application fixtures, offline-service errors and native or authenticated limitations require separate evidence from each real frontend; the synthetic regression is not complete application acceptance.

## Pinned primary reader profile

The reader adds these exact import names. Only the host uses npm aliases; prepared packages and portable imports require the registry version shown, without ranges or install aliases.

| Import name | Version |
| --- | --- |
| @tauri-apps/plugin-dialog | 2.8.1 |
| cmdk | 1.1.1 |
| dompurify-v3416 | 3.4.16 |
| github-slugger | 2.0.0 |
| highlight-js-v1112 | 11.12.0 |
| katex | 0.16.47 |
| mermaid | 11.17.2 |
| pdfjs-dist-v5 | 5.7.284 |
| rehype-katex | 7.0.1 |
| rehype-raw | 7.0.0 |
| rehype-slug | 6.0.0 |
| rehype-stringify | 10.0.1 |
| remark-math | 6.0.0 |
| remark-parse | 11.0.0 |
| remark-rehype | 11.1.2 |
| unified | 11.0.5 |
| yjs | 13.6.32 |
| zod-v4 | 4.6.5 |

PDF5, Zod4, DOMPurify3.4.16 and Highlight11 use separate names so existing PDF6/Zod3 and editor callers retain their versions. Root DOMPurify3.4.15 and Highlight10.7.3 are explicitly retained. The dialog plugin's nested Tauri API2.12.1 and Mermaid's nested DOMPurify3.4.16 use scoped overrides. Importing a Tauri dialog function or creating a local Yjs document establishes neither native dialogs nor collaborative synchronization.

Project-source workers use ESM output and fresh instances of the same host dependency resolver and canonical file boundary. Worker builds can split dynamic modules; they cannot load source outside their authorized roots. For packages declaring both exact Mermaid11.17.2 and PDF5.7.284, Vite prebundles the declared reviewed dependencies together and disables late discovery, preventing disabled-HMR previews from losing already loaded Mermaid chunks. The optimizer receives explicit aliases into the authorized host modules. The existing pinned `decode-named-character-reference`1.3.0 and `hast-util-from-html-isomorphic`2.0.0 use their no-DOM Worker exports in this reader profile; their default browser exports require `document`/`DOMParser`. Real worker results, character/entity handling, HTML sanitation and actual application behavior need execution evidence.

Projects declaring exact `pdfjs-dist-v5: "5.7.284"` can fetch that installed profile's CMaps, standard fonts and WASM files under `/__rdesign_resources/pdfjs-v5/{cmaps,standard_fonts,wasm}/<basename>`. The server accepts GET/HEAD, fixed folders and bounded basenames, verifies canonical installed paths and uses `nosniff` with WASM's correct MIME. The production build emits the same vendor files. This endpoint serves vendor resources, not arbitrary project PDFs. Package recognition and a resource HTTP200 do not establish that a particular PDF required or used that resource.

### Explicit unchanged reader fixtures

The optional prepared configuration admits one plain CJK short-word Markdown and an explicit subset of six committed PDF samples. It does not change generic private-path capture/import or add PDF to portable binary extensions.

```json
{
  "readerMarkdownFixture": { "sourceSha256": "64-character-lowercase-hex-SHA256" },
  "readerPdfFixtures": [{
    "sourcePath": "fixtures/r-md-workspace/09-pdf/sample-report.pdf",
    "sourceSha256": "64-character-lowercase-hex-SHA256"
  }]
}
```

Exactly one staged Markdown record must declare `sourceRole: "reader-markdown-fixture"`, source `fixtures/r-md-workspace/06-cjk/short-tokens.md`, prepared destination `src/fixtures/r-md-workspace/06-cjk/short-uiTokens.md`, and identical source/prepared/configured digests. The Git source must be a regular blob at the exact commit, no larger than16KiB. The proof accepts UTF-8 plain short-word content with its required heading/CJK/UI/DB/CJK terms, rejecting links, HTML, code fences, encoded payload markers and the existing private-content markers. Only this exact final filename receives the provenance exception; a private ancestor, a different file, adapted bytes or an unused/missing role/profile fails.

PDF source paths are limited to `bookmarked-report`, `chinese`, `encrypted`, `multipage`, `sample-report` and `scanned` under `fixtures/r-md-workspace/09-pdf/`. Each split ledger record must declare `sourceRole: "reader-pdf-fixture"` and match one unique configured path/digest. Canonical base64 chunks must reconstruct the regular committed Git blob unchanged, at most1MiB; role/path/digest/size gates apply before that source is read. Header/EOF and the existing decoded-content checks also apply. Missing, duplicate or unused profiles fail. Reserved provenance records `parsingVerified: false`: origin/header proof is distinct from parser, canvas, text, password, font and Worker evidence.

The synthetic reader test packs/imports/builds its disposable committed fixtures, renders actual Markdown/GFM/math and strict Mermaid, exercises DOMPurify/Highlight/Zod4/local Yjs/PDF5, checks two-page canvas/text and genuine Markdown/PDF workers, compares controlled vendor-resource bytes, and verifies a source-bound candidate/apply/revert. It also rejects a project-worker source escape. This does not accept a real reader application, authenticated services, disk writes, native dialogs, OCR, or automatic HTTP Range/streaming. Data-URL fixtures load complete bytes; separate Range or vendor-resource checks must never be presented as automatic PDF streaming evidence.

## Pinned message and document preview dependencies

This browser profile registers Redux Toolkit `2.13.0`, React Redux `9.3.0`, Prism `1.30.0`, rehype-sanitize `6.0.0` and notification module `2.5.1`. Separate import names `lucide-react-v152`, `react-markdown-v10` and `pdfjs-dist-v6` select icons `1.52.0`, Markdown `10.1.0` and PDF.js `6.4.299`; the host alone uses npm install aliases. Prepared packages and portable imports declare those exact version numbers. The original Markdown/icon profiles remain available. Redux `4.2.1` remains pinned under `dnd-core`, while the new profile uses Redux `5.0.1`. The notification module's own Tauri API is scoped to `2.12.1`; the existing host Tauri API stays at `2.8.0`. Browser module loading does not establish native notification permission, delivery or activation.

The PDF profile preserves the matched `pdfjs-dist-v6/legacy/build/pdf.mjs` and `pdfjs-dist-v6/legacy/build/pdf.worker.min.mjs?url` entries. The existing Vite resolver/URL transform and canonical serving boundary handle them. `tests/protocol/message-preview-runtime.test.ts` uses a disposable two-page PDF generated as controlled UTF-8 fixture text, then proves real worker messages, page text, nonempty rendered canvas pixels and a bounded HTTP Range response in initial/candidate/applied/reverted runtimes. The generic asset allowlist still does not admit binary `.pdf` files. Arbitrary document fonts, CMaps, WASM, passwords or source applications need their own resource and semantic evidence.

The same synthetic prepared-pack/import test checks Redux state transitions, the separate icon alias, Markdown GFM tables, blocked remote images, unsafe-link/HTML sanitation and actual Prism keyword color. It retains the existing package/path/content checks and needs no project-local `node_modules`. Actual messaging, file transfer, synchronization, authentication, plugin installation and native operations require application-specific evidence; an offline engineering fixture supplies only explicitly labelled local sample state and resources.
