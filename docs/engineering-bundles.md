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

These packages are preserved when importing and resolved through the host for both live and candidate previews, including export subpaths such as `three/addons/...`. A browser import of the Tauri API does not provide native IPC. Other dependencies or versions require an explicit host compatibility change and execution evidence. Workspaces, `file:` dependencies, aliases, JSX-only entry points, React 18, Vue and Next are not automatically adapted. Core tool dependency declarations use the existing importer policy; the controlled host still selects its React/tool versions.

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

The prepared tree passes the same path, file, dependency and bundle limits as import. The packer seals its captured bytes, records every prepared file hash in reserved `src/rdesign-prepared-origin.json`, and runs the existing v1 validator/preflight. It does not prove that the ledger lists every original frontend file or that an adapter preserves application semantics. Those require separate source review, resource coverage, browser scenes, business assertions and candidate tests. Private source text, authenticated dependency URLs and production data must not be placed in public recipes or bundles.

```text
{ format: "rdesign-project", schemaVersion: 1,
  manifest, document: {schemaVersion: 1, project, changes},
  sourceFiles: [{path, content, sha256, encoding?: "utf8" | "base64"}], checksum }
```

Each file digest covers UTF-8 bytes or decoded base64 bytes. The bundle digest covers `JSON.stringify(payload)` with `checksum` omitted, preserving property order; it is not a digest of pretty-printed bytes. Limits remain 1 MiB per file, 1,000 source files and 24 MiB of serialized payload. The importer creates a new project identity, reuses controlled executable metadata, marks scenarios unverified and makes imported change history read-only.

Imported scenarios with historical snapshots display “待重新验证”. Their images remain historical evidence; a new live instance must recapture the scene before it is current.

Preflight shares the importer's integrity, path and dependency checks, then checks source imports, common CSS resource references, standard entry/SDK references and registered scene dependencies. Its report is **structural evidence**. It does not prove browser execution, business transitions, dynamically computed assets, backend connectivity or native capabilities.

For delivery, import into an isolated data root, execute desktop and narrow scenes, assert the actual business state transitions, capture real runtime frames, verify exact/ambiguous source mappings, and run a candidate edit when applicable. Report original limitations and unavailable services explicitly. Use separate synthetic fixtures for unavailable backends; never package production credentials or private business data. Keep private source bundles in a private delivery location, rather than adding them to a public host repository.
