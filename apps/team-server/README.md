# Team control service

The team service stores users, project membership, immutable screenshot versions, comments, review decisions and an audit timeline. It does not accept executable source or fetch source URLs. The existing local Bridge continues to run and verify projects; upload only its resulting screenshot and bounded evidence to this service.

Use Node 22.13 or newer, including `node:sqlite`, and the root repository dependencies:

```powershell
$env:RDESIGN_TEAM_ADMIN_EMAIL = 'admin@example.com'
$env:RDESIGN_TEAM_ADMIN_PASSWORD = '<a unique password of at least 12 characters>'
$env:RDESIGN_TEAM_ADMIN_NAME = 'Administrator'
node --import tsx apps/team-server/src/index.ts
```

Bootstrap creates one administrator only when the user database is empty. Subsequent startup settings never replace existing credentials. Administrators create accounts through the team UI or API; there is no public self registration. Project creators become owners. Even administrators need project membership to read its designs.

| Environment variable | Default / purpose |
| --- | --- |
| `RDESIGN_TEAM_HOST` | `127.0.0.1`; bind interface |
| `RDESIGN_TEAM_PORT` | `4315` |
| `RDESIGN_TEAM_DATA_DIR` | `.rdesign/team`; private SQLite directory |
| `RDESIGN_TEAM_PUBLIC_ORIGIN` | Local HTTP origin; production must explicitly use HTTPS |
| `RDESIGN_TEAM_BASE_PATH` | Empty; production `/r-design` |
| `RDESIGN_TEAM_STATIC_DIR` | `dist/workbench`; compiled team UI |
| `RDESIGN_TEAM_ADMIN_EMAIL` | Required to bootstrap an empty database |
| `RDESIGN_TEAM_ADMIN_PASSWORD` | Required to bootstrap; 12–128 characters |
| `RDESIGN_TEAM_ADMIN_NAME` | `Administrator` |

The public API lives at `${BASE_PATH}/api/team`. `/health` returns `{"status":"ok"}`. `/auth/login`, `/auth/me`, `/auth/logout` and `/auth/password` manage authentication. `/users` is administrator only; `/projects` lists only memberships. A project detail includes members, versions, comments and activity. All project mutations require an `operationId` containing 8–128 letters, numbers, dashes or underscores; use `crypto.randomUUID()`. Repeating an identical operation returns its original result after rechecking authorization. Reusing the operation ID with different content returns 409. Password-bearing operation signatures use scrypt with an independent random salt, so receipts do not weaken password storage; ordinary design signatures use SHA-256.

Owners manage members. Owners and designers publish and submit versions. Owners and reviewers decide reviews; creators and submitters cannot review their own designs. Viewers may read and comment. Review requires the latest version, its exact `contentHash` and a valid state: `draft → in_review → approved` or `changes_requested`. After requested changes, publish a new immutable version. A newer draft prevents decisions on older pending versions. A project must retain at least one owner.

Production uses a loopback reverse proxy and HTTPS. Send the public `Host` and overwrite `X-Forwarded-For` with the actual client address; set `X-Forwarded-Proto` to HTTPS. Proxy headers are trusted only from loopback addresses. The service validates `Host`, `Origin` and browser fetch metadata, requires JSON writes, and issues HttpOnly, SameSite Strict, Secure cookies for HTTPS origins. Sessions last eight hours, survive restarts and are stored as hashes. Logout revokes a session; changing a password revokes every session for that account. Login failures use persistent account and client address limits.

Store `team.sqlite` and its WAL files outside the public directory. Use an online SQLite backup or stop the service before copying the database, rather than copying only the active main file. Protect backups as account and design data. The static handler exposes only compiled assets, favicons and `/team` deep links, and rejects paths that resolve outside the public directory.

Screenshot uploads accept nonanimated PNG, JPEG and WebP, up to 10 MiB, 8192 pixels per dimension and 32 megapixels. PNG checks include CRC, decoded scanline sizes and filters, with a 128 MiB decoded memory cap. JPEG and WebP signatures, frame dimensions and container structure are checked. APNG, animated WebP, SVG and executable URLs are rejected. A `sourceUrl` is an HTTPS reference link only. Versions accept up to 1000 layers, 100 evidence records, 60,000 diff characters and 6000 summary or evidence detail characters. Comment anchors use normalized coordinates in `[0,1]`.

This first release returns screenshot data inside project details and stores it in SQLite, including operation receipts. Large projects therefore require more bandwidth and database capacity; future object storage and pagination can reduce that cost. The server validates uploaded evidence structure, while local Bridge execution supplies the evidence itself; an uploaded `passed` flag is a declared result, not an independent cloud verification.

Run `npx vitest run tests/protocol/team-server.test.ts` for the protocol and security acceptance suite. Use the deployment files under `deploy/tencent` for the Tencent Cloud reverse proxy and service configuration.
