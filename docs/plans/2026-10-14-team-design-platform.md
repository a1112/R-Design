# Team Design Platform Implementation Plan

> **For implementation:** Use independent scoped agents, test behavior before implementation, review spec compliance then code quality, and verify before completion.

**Goal:** Merge useful remote branches and deploy a usable team design version, traceability and approval workspace to the existing Tencent server.

**Architecture:** Keep the local Bridge and add a separate same-origin team control service. Immutable visual versions and their evidence live in transactional SQLite; runtime execution remains in the authorized local runner. A `/team` React workspace shares the existing build without changing local routes.

**Tech Stack:** React 19, TypeScript, Vite, Express 5, Node SQLite, Vitest, Playwright, systemd and nginx/TLS.

## Task 1: Integrate existing branches

Merge reader-pdf5-runtime, controlled-react18-profile, source-dependency-contract, version-management and small-tool-engineering-bundles on `codex/team-design-platform`. Preserve both runtime profiles and PDF/editor worker handling. Reproduce and fix the documented external script/path/cold cache boundaries with meaningful regressions. Verify all remote tips are ancestors, `npm test`, `npm run build`, and real runtime e2e.

## Task 2: Team service

Create `packages/team-protocol/src/index.ts`, `apps/team-server/src/store.ts`, `apps/team-server/src/server.ts`, `apps/team-server/src/index.ts`, and `tests/protocol/team-server.test.ts`. Implement hash passwords, hashed persisted sessions, explicit bootstrap admin configuration, SQLite transactions, project role checks, bounded raster uploads/immutable node geometry, hash-bound approval transitions with no self approval, comments, audit and operation receipts. Write failing service tests first, then implement and run the focused suite. Never log credentials or expose database/static source paths.

## Task 3: Professional team UI

Create `apps/workbench-web/src/team/TeamWorkspace.tsx`, `team.css`, `api.ts`; change only the `/team` route dispatch in `App.tsx`. Build login, overview, project list, approval queue, zoom/pan design canvas, layer selection, version history, review decisions, comments, member management and administrator account provisioning. Use shared server protocol and explicit loading/error/empty states. Import raster exports and `.rdesign.json` frozen snapshots with source and verification evidence; upload no executable code. Verify role-based controls and complete browser flow.

## Task 4: Release and integration

Add `team:start`/`test:team:e2e` scripts and dedicated browser test configuration. Build and run complete existing tests and team flow. Review scope compliance, then security/concurrency/persistence/UI code quality. Fix observed defects and re-run affected checks.

## Task 5: Tencent deployment

Add deployment/readme/service template under `deploy/tencent` and `docs`. Use a separate release/data location and distinct service from existing applications. Send a tested source/build archive, install locked dependencies, configure trusted HTTPS reverse proxy, create random initial admin credentials privately, activate service, then verify remote health and a authenticated account/project workflow without seeding production demo content. Document URL, access file, backup/restore and rollback.
