# Controlled browser runtime profiles

Independent review still has three unresolved findings: HTML external-script handling, dependency-path boundaries and cold-cache path handling. The corresponding security work is paused and has not been rerun or changed in this follow-up. The implemented checks described below do not establish that these findings are resolved. This follow-up addresses only custom Fiber intrinsic instrumentation and pure type-import compilation.

Managed previews keep the existing host React 19 runtime by default. A project can explicitly select the host-owned React 18 runtime with this package metadata:

```json
{
  "rdesign": { "runtimeProfile": "react18" },
  "dependencies": {
    "@rdesign/runtime-web": "*",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
```

Only `react19` and `react18` are recognized. The metadata does not accept paths, aliases, registries or extra fields. React 18 portable packages require exact core versions, including declarations in optional/dev dependencies. Omitting the metadata preserves legacy normalization and React 19 behavior. Switching profiles in an active runtime requires a new runtime instance; it cannot reuse an incompatible live preview.

The original-source engineering configuration also accepts `runtimeProfile: "react18"`. Its original React/ReactDOM declarations must normalize to 18.3.1; the output replaces executable metadata with controlled scripts and exact versions. Prepared-source packaging retains the explicit package metadata and verifies its original/adapted hashes as before. Import reconstruction preserves the selected profile. Live and candidate runtimes use the same resolver and package checks.

## Host-owned versions

`packages/runtime-react18/package.json` is a separate host workspace with no lifecycle scripts. It contains this exact renderer combination:

| Package | Version |
| --- | --- |
| react / react-dom | 18.3.1 |
| @react-three/fiber | 8.18.0 |
| @react-three/drei | 9.122.0 |
| three | 0.183.2 |
| @types/react | 18.3.31 |
| @types/react-dom | 18.3.7 |
| @types/three | 0.183.1 |

The renderer contracts require React 18: fiber 8.18.0 has React `>=18 <19` peers, and drei 9.122.0 has React `^18` and fiber `^8` peers. They are resolved from installed, host-owned paths, with runtime version checks and no fallback to the default React major. The root React 19 dependencies remain unchanged. Direct versions are exact; transitive versions, registry URLs and integrity values are recorded in the host lockfile. Newly resolved packages use `https://registry.npmjs.org/`. No package is installed from an imported project or an engineering bundle.

The new profile admits the reviewed renderer names and versions and keeps existing reviewed browser dependencies except Router and the host React-19-specific Recharts combination. It does not authorize arbitrary packages or ranges. Source and resolver checks reject Router, unregistered packages, remote module imports, package import aliases, nonliteral dynamic imports and direct host dependency paths, including symlink escapes. HTML script entries must be local project modules; remote/classic script entries, direct host dependency paths, project import maps and base redirects are rejected. The controlled Vite client, React refresh runtime, generated dependency cache and exact `vite/modulepreload-polyfill` import remain supported.

## Source and file boundaries

Project executable configurations, package lifecycle scripts, private-content checks, normalized portable paths, provenance checks and resource limits retain their existing policy. React 18 linked projects also reject lifecycle scripts and package-level dependency redirects; inline host PostCSS configuration disables discovery of project plugins. Vite still disables the project configuration and public directory, binds to loopback, disables HMR/WebSocket serving, and applies canonical file/private-root checks. The only added host filesystem allowance is the installed React 18 workspace's dependency directory. These checks control the managed module/tooling boundary; they do not make arbitrary application JavaScript a security sandbox.

The DOM observer remains framework-independent. React 18 instrumentation combines the element's original ref with a stable source-ID callback. It sets the ID only when the actual mounted instance is an Element in its owning DOM window; the ID is never passed as an element prop to Three. This supports cross-component and dynamically extended intrinsics even when their names match HTML tags, without relying on lexical Canvas ancestry or a tag blacklist. DOM toolbars and Drei `Html` portals retain source mapping; callback and object refs are forwarded. Legacy string refs are preserved without automatic IDs. The default React 19 transform is unchanged. Canvas and Shadow DOM retain their existing explicit degradation states; this change does not add a scene editor or prove native window behavior.

Both `import type { T }` and declarations containing only inline type specifiers (`import { type T }`) are erased before runtime compilation. Their character positions are retained for source mapping. Mixed declarations keep their value imports and the existing runtime import checks.

## Verification and audit limits

Synthetic tests cover source and prepared packing, two independent imports, both runtime kinds, React major and JSX-runtime identity, hook updates, Motion/icons, reload, dependency/script/metadata negatives, missing host packages, metadata symlinks, active-profile changes, Three metadata with restricted exports, source-ID exclusion, ignored project PostCSS plugins and private/escape HTTP boundaries. Existing regression tests exercise the default runtime.

The synthetic renderer test also runs an actual fiber8/drei9 WebGL2 cylinder in live and candidate runtimes, checks real framebuffer colors before and after a React state update, exercises mesh hover and narrow-screen resizing, and reloads the scene. On the verified Mac mini this uses the installed full official Chromium with `--disable-gpu` and its ANGLE/SwiftShader WebGL2 renderer. This is software WebGL2 evidence; GPU hardware, native windows and any particular private frontend remain separate acceptance work.

The preserved lockfile adds 72 entries: 70 public registry packages, one host workspace manifest and one workspace link. All pre-existing entries are byte-for-byte unchanged, with no removals or new install lifecycle flags; all added registry entries have npm registry URLs and SHA-512 integrity values. A 2026-10-12 query to the official npm Bulk Advisory endpoint sent only public package names and exact versions, excluding internal workspaces, paths, scripts, credentials, source and assets. Exact-version checks found no advisory matches among the 70 added registry entries. The existing host React Router 7.9.3 still matches high/moderate advisories; it is excluded from the new profile and remains unremediated in the default host. This advisory lookup is not a malware review, registry-signature check or full npm meta-vulnerability report, and is not a vulnerability-free guarantee.
