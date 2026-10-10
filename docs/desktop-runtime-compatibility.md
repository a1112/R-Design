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
