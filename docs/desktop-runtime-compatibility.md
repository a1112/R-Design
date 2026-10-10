# Desktop frontend compatibility: first batch

The host ships the production dependencies needed by the prepared R-ShareMouse,
R-Link and DevTools browser entries. The package registry still accepts exact
reviewed versions only. Importing an engineering bundle never installs packages.
Native services, window controls, device discovery, remote connections and
environment detection remain unavailable in these isolated browser previews.

The host keeps `lucide-react@0.468.0` for existing projects and also ships the npm
alias `lucide-react-v0487` for `lucide-react@0.487.0`. A prepared-source adapter
must explicitly rewrite that version's import declarations to
`lucide-react-v0487` and declare `"lucide-react-v0487": "0.487.0"`. Declaring
`"lucide-react": "0.487.0"` is still rejected. Both live and candidate runtimes
resolve these registered import names through the same host packages.

Recharts 2.15.4 declares React 19 support but normally installs `react-is@18.3.1`.
That package cannot identify React 19 fragments, so a chart's otherwise valid
fragment-wrapped children can disappear. The host applies an exact scoped npm
override only for `react-is@18.3.1` under `recharts@2.15.4`, pinning it to `19.3.0`.
Recharts itself and the legacy icon version stay unchanged; other packages'
`react-is` versions are not overridden. This is a reviewed host dependency
correction, not a peer override or a capability for imported package metadata.
Bundle-supplied `overrides` remain forbidden. The new regression checks direct,
fragment and nested-fragment chart children in SSR and in an officially imported
browser project, including a verified, accepted and semantically reverted
candidate. The initial failure was established with synthetic chart composition;
it does not establish that any of the three real frontends lost user data.

Prepared projects retain their application source and static assets. An explicit
adapter records the reachable entry graph and retains only that graph's package
declarations. Unreachable executable modules are retained verbatim as
`.reference.txt` files, with the renames and source hashes recorded in the ledger.
Enabling those optional components requires another dependency review. This avoids installing unused
`react-day-picker@8.10.1`, whose peer contract does not include the host's React
19. No peer overrides or forced installs are needed. All adaptations and changed
file hashes must be recorded in the prepared-source ledger before `pack-prepared`.

This batch does not alter private-path, credential, binary resource, Git
provenance or executable-config checks. Source paths containing `tokens.ts` or
a `design-tokens` directory still require separate review and are not admitted
through a generic exception. Other desktop projects and package generations
remain outside this batch's compatibility claim.

`tests/protocol/desktop-runtime.test.ts` checks both icon generations, QR output,
the context menu, motion, charts, toast and the terminal in an actual imported
project, then builds, accepts and semantically reverts a candidate. A semantic
revert can change equivalent JSX formatting; it does not promise byte-identical
source restoration.
