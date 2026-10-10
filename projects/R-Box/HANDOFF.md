# Small tool engineering adapters

These recipes own only `projects/R-Box`, `projects/R-Vault`, `projects/R-Clip`,
`projects/R-Alpha`, `projects/ModelBase`, `projects/ToolBox`, and `projects/SaveDock`.
They do not change host packages, the project workspace, runtime or engineering CLI.
Private repositories, complete source bundles and screenshots stay outside this
public checkout. Edit anchors and JSX matching fragments are SHA256 plus UTF-16
lengths. No original business source or assets are committed here.

| Source | Ref | Exact committed source |
| --- | --- | --- |
| a1112/R-Box | main | 3cb991174ba925982cba5a1332e7d3df1570262d |
| a1112/R-Vault | main | 4608bf58af4021df49e4378892317b5bf5fcad8c |
| a1112/R-Clip | main | bb0ef170bee0848d670f8366e76f8aee3d909d04 |
| a1112/R-Alpha | agent/initial-project | db6613f2ace38b9289fa2f8a610fece230042b50 |
| a1112/ModelBase | main | d57f53597e53c3693fdb0ebfeb4595b912ad2f77 |
| a1112/ToolBox | main | 4b04f8dc59766e9c899c4a9deb976ae6cf2d4c37 |
| a1112/SaveDock | main | cf5802cbec5121519905ba108e26d9a21278e954 |

## Tool checkpoint and result

All seven full `rdesign-project` v1 bundles were regenerated with the official
`pack-prepared` CLI at merged main **eeffd77924463dcfec05ba1b438e92047d495a23**. The packer
checks committed Git bytes, adapted file hashes and lossless resource chunks,
then embeds `src/rdesign-prepared-origin.json`. The helper subsequently captures
real scene frames with this exact host, adds those frames to the document, and
revalidates the complete schema, preflight and payload checksum. The raw official
pack and generation report are retained privately.

[PR2](https://github.com/a1112/R-Design/pull/2) was normally merged after independent
review of encoded-resource content and Unicode Git paths. Acceptance below was
regenerated and rerun on **eeffd77924463dcfec05ba1b438e92047d495a23**, including
formal imports, preflight, all scenes, business assertions and actual Workbench
imports/restarts. The old draft candidate's bundles and reports remain a separate
private archive and do not count toward this final result.

| Project | Scenes | Schema / checksum / preflight / import | Imported runtime / build / mapping / interactions | Workbench import / restart | Candidate verify / accept / semantic revert |
| --- | ---: | --- | --- | --- | --- |
| R-Box | 6 | Passed | Passed | Passed | Passed |
| R-Vault | 6 | Passed | Passed | Passed | Passed |
| R-Clip | 4 | Passed | Passed | Passed | Passed |
| R-Alpha | 10 | Passed | Passed | Passed | Passed |
| ModelBase | 7 | Passed | Passed | Passed | Passed |
| ToolBox | 12 | Passed | Passed | Passed | Passed |
| SaveDock | 5 | Passed | Passed | Passed | Passed |

There are 50 fresh packed-source captures, 50 imported-host scene checks and seven
actual Workbench file-chooser imports followed by isolated Bridge restarts.
Imported scenario badges reset to `unverified`; screenshots remain historical
evidence until recaptured. Imported identities are distinct, source hashes are
preserved except the importer's controlled root package, and restarted frames have
fresh runtime sessions. Five meaningful adapter/asset contract tests and six
merged-main prepared-engineering regressions pass.

**Shared-host rollback limitation:** controlled text revert restores the original
rendered text and exact mapping, but rewrites plain JSX text as a string expression.
For example `<h1>R-Box</h1>` becomes `<h1>{"R-Box"}</h1>`. All seven selected
targets passed semantic revert; none restored the original file bytes or code
revision. This is recorded separately as `importedBytesRestored: false` and
`codeRevisionRestored: false`, rather than treating semantic revert as byte-exact
undo. Only disposable imported test copies are changed. Pinned repositories,
prepared sources and delivery bundles remain unchanged. No shared tool was fixed
or bypassed here.

The archive's 109 tracked files were compared byte-for-byte to the stated Git
commit; the private `toolchain-manifest.json` records their SHA256 values and tree.
Each bundle carries file hashes and its v1 payload checksum. `acceptance.json`
records exact source and tool SHAs, every status, rollback limits and report paths;
`SHA256SUMS` records hashes of the delivery files themselves.

## Reproduction

`engineering.json` is an adapter recipe. `scenarios.json` uses the actual v1
scenario schema. Preparation reads committed Git objects, refuses a dirty or
incorrect source checkout, preserves the complete frontend runtime source and
referenced resources under `src/upstream`, and writes the original/adapted hashes
to `src/rdesign-preview/provenance.json`. All seven hashed recipes were replayed
and produced byte-identical staged files.

Run from this R-Design checkout with authorized clean source clones at the table's
SHAs, an exact archive of merged main, and main's reviewed dependencies.
Each staging directory must initially be empty. Packing exclusively creates its
output files and refuses to overwrite an existing bundle.

```sh
for project in R-Box R-Vault R-Clip R-Alpha ModelBase ToolBox SaveDock; do
  node projects/R-Box/prepare.mjs "$project" "../sources/$project" "../deliverables/staged/$project"
done
node --import tsx --test projects/R-Box/preview-contracts.test.ts
node --import tsx projects/R-Box/pack.ts ../toolchain-eeffd77 eeffd77924463dcfec05ba1b438e92047d495a23
node --import tsx projects/R-Box/verify-toolchain.ts ../toolchain-eeffd77 eeffd77924463dcfec05ba1b438e92047d495a23
node --import tsx projects/R-Box/verify-candidate.ts ../toolchain-eeffd77 eeffd77924463dcfec05ba1b438e92047d495a23
node --import tsx projects/R-Box/verify-bridge.ts ../toolchain-eeffd77 eeffd77924463dcfec05ba1b438e92047d495a23
node --import tsx projects/R-Box/summarize.ts --main eeffd77924463dcfec05ba1b438e92047d495a23
```

The old baseline compatibility generator has been removed. Current capture and
verification use the actual merged-main runtime and default build target, without
dependency aliases or an alternate importer. Browser checks use new headless
contexts and independent loopback ports. Workbench verification owns its Bridge
process and data directory, consumes bootstrap tokens without printing/storing
them, and restarts only that process. Existing windows and ports are untouched.

## Dependencies and retained UI limits

The installed host's React/React DOM 19.3.0 and all additions match the merged-main
lockfile. ModelBase and SaveDock originally declare React 18; their complete UI is
explicitly adapted and tested on the controlled React 19 host. ToolBox expects Zod
4, so its import explicitly uses the v4 export of the registered Zod 3 package.

| Package | Reviewed version | Consumer |
| --- | --- | --- |
| lucide-react | 0.468.0 | R-Box, R-Vault, R-Clip |
| react-markdown | 9.0.3 | ModelBase |
| remark-gfm | 4.0.1 | ModelBase |
| i18next | 25.10.0 | ToolBox |
| react-i18next | 16.3.5 | ToolBox |
| react-router-dom | 7.9.3 | ToolBox |
| uplot | 1.6.32 | ToolBox |
| zod | 3.25.76, `/v4` export | ToolBox |

The original design is retained. R-Alpha and ModelBase have original minimum widths
of 1060 and 1080px; their 390px scenes overflow horizontally. ToolBox's narrow
hardware specification row can clip long values. Dynamic/repeated JSX remains
read-only or ambiguous. Static text has been mapped, changed, rendered, built,
accepted and semantically reverted through the actual ChangeEngine.

## Preview scope

Every project shows `设计预览 / 未授权`. Browser local/session storage becomes
per-page memory before upstream modules run. External fetches/windows, system
clipboard access and native IPC reject explicitly. Native effect receipts are
never reported as successful.

R-Box retains its committed read-only catalog and disabled unified login. R-Vault
uses disposable synthetic cards and rejects trusted native authorization. Its
fixed internal `fixture-` token does not authenticate a person; there is no real
credential read or password entry. R-Clip uses owned synthetic snippets. R-Alpha
retains deterministic demo markets and locked real trading. ModelBase remains
offline without API credentials, deployment, inference or benchmarks.

ToolBox uses synthetic hardware/telemetry and rejects hardware start/stop, native
report export and directory opening. Failed export creates no successful receipt.
Its `runDiagnostics` method returns an upstream static fixture; settings change
only per-page memory. SaveDock uses synthetic game/history models and rejects all
file and sync mutations. Fixture data does not establish backend connectivity,
encryption, hardware measurements, authentication or actual game compatibility.

ToolBox's original 1,597,505-byte PNG is retained losslessly in JSON chunks under
1 MiB and decoded into a Blob URL. The original digest, byte length and chunk paths
are recorded and checked against Git by the official packer and the asset test.
The original logo is included. CSS design-token files have explicit compatibility
renames with unchanged bytes. Every application resource is under `src`.

No `.env`, credentials, real private user data, Git history, node_modules, native
or backend build is bundled. Executable upstream configuration/hooks and upstream
development test runners are excluded. Referenced ToolBox fixture-contract JSON
is included. The seven clean pinned clones have no Git replace refs or grafts.
