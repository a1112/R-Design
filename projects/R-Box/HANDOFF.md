# Small tool engineering adapters

These recipes own only `projects/R-Box`, `projects/R-Vault`, `projects/R-Clip`,
`projects/R-Alpha`, `projects/ModelBase`, `projects/ToolBox`, and `projects/SaveDock`.
They do not change the host package, project workspace, runtime, or engineering CLI.
The original repositories and all private source bundles stay outside this public
checkout. No source working tree is edited. Preparation reads Git objects and fails
when the requested checkout is not the pinned clean commit.
Private-source edit anchors and JSX matching fragments are stored only as SHA256
and UTF-16 lengths. No original source text or business assets are committed here.
All seven hashed recipes were replayed and produced byte-identical staged files.

| Source | Ref | Commit |
| --- | --- | --- |
| a1112/R-Box | main | 3cb991174ba925982cba5a1332e7d3df1570262d |
| a1112/R-Vault | main | 4608bf58af4021df49e4378892317b5bf5fcad8c |
| a1112/R-Clip | main | bb0ef170bee0848d670f8366e76f8aee3d909d04 |
| a1112/R-Alpha | agent/initial-project | db6613f2ace38b9289fa2f8a610fece230042b50 |
| a1112/ModelBase | main | d57f53597e53c3693fdb0ebfeb4595b912ad2f77 |
| a1112/ToolBox | main | 4b04f8dc59766e9c899c4a9deb976ae6cf2d4c37 |
| a1112/SaveDock | main | cf5802cbec5121519905ba108e26d9a21278e954 |

## Reproduction

`engineering.json` in each directory is an adapter recipe, rather than a file
accepted directly by the first host engineering CLI. `scenarios.json` is the
actual version 1 scenario schema. The helper preserves the full committed frontend
runtime source and referenced resources under `src/upstream`, then records every
original and adapted SHA256 in `src/rdesign-preview/provenance.json`.

```sh
for project in R-Box R-Vault R-Clip R-Alpha ModelBase ToolBox SaveDock; do
  node projects/R-Box/prepare.mjs "$project" "../sources/$project" "../deliverables/staged/$project"
done
node --import tsx --test projects/R-Box/preview-contracts.test.ts
node --import tsx projects/R-Box/verify.ts R-Box R-Vault
node --import tsx projects/R-Box/verify-toolchain.ts ../toolchain-fd56327 fd563274e0add377460ec537729675af9b52a3ac
node --import tsx projects/R-Box/verify-candidate.ts ../toolchain-fd56327 fd563274e0add377460ec537729675af9b52a3ac
node --import tsx projects/R-Box/verify-bridge.ts ../toolchain-fd56327 fd563274e0add377460ec537729675af9b52a3ac
node --import tsx projects/R-Box/summarize.ts --frozen fd563274e0add377460ec537729675af9b52a3ac
```

Run from the R-Design checkout. Source clones must be clean at the commits above;
each staging directory must be empty for preparation. The provided private bundles
are ready for direct import testing without preparing them again. The toolchain
verifiers accept either a Git checkout or a byte-exact archive of the stated SHA.
The frozen archive is `task-8/toolchain-fd56327`, with shared host dependencies.

The verifier uses a new headless browser and an operating-system-assigned free
loopback port. It never attaches to a user's existing browser or window. Temporary
frontend dependency aliases allow compatibility checks before the shared host
dependency registry is extended; this mode is recorded in the evidence. A passing
runtime test is not a claim that the baseline importer supports those dependencies.
The toolchain verifier imports two independent copies, verifies the preserved
source hashes, checks reset scenario status, and then uses the actual host runtime
on imported source without dependency aliases or build-target overrides. Both
verifiers use the host's default build target. Build output is removed from the
owned staging directory before capture and portable bundling.

Each private delivery contains the full v1 bundle, real scenario PNGs, checksum,
file hashes, import identity checks, mapping evidence, business assertions and
explicit blocked states. Imported scenarios must become `unverified`.

## Verified checkpoint

All seven complete private v1 bundles were generated with embedded frontend source,
resource hashes and real screenshots. Acceptance below was repeated against the
parent-confirmed frozen tool `fd563274e0add377460ec537729675af9b52a3ac`.

| Project | Scenes | Temporary host compatibility | Frozen schema/preflight/import | Actual imported host runtime/build/mapping/interaction |
| --- | ---: | --- | --- | --- |
| R-Box | 6 | Passed | Passed | Passed |
| R-Vault | 6 | Passed | Passed | Passed |
| R-Clip | 4 | Passed | Passed | Passed |
| R-Alpha | 10 | Passed | Passed | Passed |
| ModelBase | 7 | Passed | Blocked: IMPORT_CONFIG | Blocked by dependency registry |
| ToolBox | 12 | Passed | Blocked: IMPORT_CONFIG | Blocked by dependency registry |
| SaveDock | 5 | Passed | Passed | Passed |

Compatibility means actual browser scenes, default Vite build, static source
mapping and business assertions on the temporary host. It does not bypass the
import registry. There are 50 captured scenes, 31 reverified through imported
source and five passing adapter/asset contract tests. Native hardware start/stop,
report export and directory opening all reject. Browser assertions also prove
that failed export does not create a successful export receipt. The five accepted
projects also passed actual Workbench file-chooser import, live frame/mapping,
unverified historical scenarios and restart of their own isolated Bridge process
with the same active project and a fresh runtime session.

The installed host uses React/React DOM 19.3.0, matching the frozen lockfile.
Per-file SHA256 and the v1
payload checksum are in each bundle; the private `deliverables/acceptance.json`
provides the precise checksum and separate states for every project.

Visual inspection preserves the committed UI. R-Alpha and ModelBase have original
minimum widths of 1060 and 1080 px, so their 390 px scenes have horizontal overflow.
ToolBox fits the narrow viewport, but its original hardware-specification row can
clip long values. These are source UI limitations, not complete mobile usability
claims. Dynamic/repeated JSX nodes remain read-only or ambiguous; mapping proof
establishes a static text transform, visible edited text with an exact source
binding, and a passing build in a separate candidate copy. Five candidates use the
actual imported host and two use the explicitly temporary compatibility host.
The original source files are checked byte-for-byte after candidate execution.

## Required host interfaces

The frozen tool is `fd563274e0add377460ec537729675af9b52a3ac`. Its
existing importer supports R-Box/R-Vault/R-Clip after their package declarations
use the exact reviewed `lucide-react` version `0.468.0`. The remaining packages
need the following controlled browser dependencies before import can pass:

| Package | Tested version | Consumer |
| --- | --- | --- |
| react-markdown | 9.0.3 | ModelBase |
| remark-gfm | 4.0.1 | ModelBase |
| i18next | 25.10.0 | ToolBox |
| react-i18next | 16.3.5 | ToolBox |
| react-router-dom | 7.9.3 | ToolBox |
| uplot | 1.6.32 | ToolBox |
| zod | 3.25.76, `/v4` export | ToolBox |

ModelBase and SaveDock originally use React 18. Their complete original UI is
tested with the controlled React 19 host; the recipe explicitly records the
adaptation rather than pretending the original dependency declaration was 19.
ToolBox originally expects Zod 4. Its import is explicitly redirected to the v4
export provided by the host's Zod 3.25.76 package, preserving v4 schema behavior.

The first generator supports literal edits and committed copies but has no
controlled overlay input, no replacement entry point, no dependency override for
a verified React 18 adaptation, and no lossless large-resource split. Either a
trusted prepared-source bundle function or explicit adapter-file inputs are needed
to ingest these recipes. `readPortableSourceFiles` and
`validatePortableProjectBundle` already provide the common strict source and schema
boundary needed by such an interface. No shared file was changed here.

## Preview scope

All projects show a persistent `设计预览 / 未授权` notice. Browser local/session
storage is replaced by per-page memory before any upstream module executes.
External fetches, external windows, system clipboard access and native IPC reject
explicitly. The adapters never return successful native effect receipts.

R-Box retains its upstream read-only catalog and disabled unified login. R-Vault
retains its disposable synthetic card model and rejects trusted native
authorization. Its fixed internal fixture token has an explicit `fixture-` prefix
and does not authenticate a person. R-Clip reads owned synthetic snippets only.
R-Alpha retains its deterministic demo markets and locked real trading actions.
ModelBase remains offline. ToolBox reads synthetic hardware/telemetry and rejects
hardware runs, native report export and directory opening. SaveDock reads synthetic
game/history models and rejects every file or sync mutation.
ToolBox's method named `runDiagnostics` only returns the upstream static diagnostic
fixture in this provider. Settings updates only modify the provider's per-page
memory and do not save native settings.

ToolBox's original 1,597,505-byte PNG is retained losslessly as JSON chunks smaller
than 1 MiB and reconstructed into a Blob URL. The original SHA256, byte length and
chunk paths are recorded. Its original logo stays inside the source boundary.
CSS design-token files are renamed explicitly for compatibility with the original
baseline path policy, without changing their bytes.

Upstream development test runners, native/backend code, executable configurations,
credentials, environment files, Git history and node_modules are excluded. Runtime
fixture contract JSON referenced by ToolBox is included. Fixture records do not
establish backend connectivity, encryption, actual hardware measurements, real
authentication, game compatibility or native IPC support.
