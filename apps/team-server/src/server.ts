import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import type { TeamRole, TeamUser } from '../../../packages/team-protocol/src/index';
import { canonical, digest, hashPassword, TeamError, TeamStore, timestamp, verifyPassword } from './store';
import * as validate from './validation';
export interface TeamAppOptions {
  dataDirectory: string; publicOrigin: string; basePath?: string; staticDirectory?: string;
  adminEmail?: string; adminPassword?: string; adminName?: string;
}
export function isLoopback(address: string) {
  if (address === 'localhost') return true;
  const type = isIP(address);
  if (type === 4) return address.split('.')[0] === '127';
  if (type !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (!normalized.startsWith('::ffff:')) return false;
  const mapped = normalized.slice(7);
  return isIP(mapped) === 4 ? mapped.split('.')[0] === '127' : /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped);
}
export function validatePublicOrigin(value: string) {
  let origin: URL;
  try { origin = new URL(value); } catch { throw new Error('RDESIGN_TEAM_PUBLIC_ORIGIN must be an explicit HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('RDESIGN_TEAM_PUBLIC_ORIGIN must contain only scheme, host and optional port');
  if (origin.protocol !== 'https:' && !isLoopback(origin.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Public team service requires an HTTPS origin');
  return origin;
}
export function validateBind(host: string, publicOrigin: string | undefined) {
  if (!isLoopback(host) && (!publicOrigin || validatePublicOrigin(publicOrigin).protocol !== 'https:')) throw new Error('Binding outside loopback requires explicit HTTPS RDESIGN_TEAM_PUBLIC_ORIGIN');
}
function basePath(value = '') {
  if (value === '' || value === '/') return '';
  const normalized = value.replace(/\/$/, '');
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(normalized)) throw new Error('Invalid RDESIGN_TEAM_BASE_PATH');
  return normalized;
}
function body(req: Request) { return validate.object(req.body); }
function administrator(actor: TeamUser) { if (!actor.admin) throw new TeamError('FORBIDDEN', 'Administrator role required', 403); }
const sessionLifetime = 8 * 60 * 60 * 1000;

export function createTeamApp(options: TeamAppOptions) {
  const publicOrigin = validatePublicOrigin(options.publicOrigin);
  const prefix = basePath(options.basePath);
  if (options.staticDirectory) {
    const staticPath = path.resolve(options.staticDirectory); const dataPath = path.resolve(options.dataDirectory);
    const within = (root: string, candidate: string) => {
      const relative = path.relative(root, candidate);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    };
    if (within(staticPath, dataPath)) throw new Error('Team database cannot be inside the public static directory');
    if (existsSync(staticPath)) {
      mkdirSync(dataPath, { recursive: true, mode: 0o700 });
      if (within(realpathSync(staticPath), realpathSync(dataPath))) throw new Error('Team database cannot be inside the public static directory');
    }
  }
  const store = new TeamStore(options.dataDirectory, options.adminEmail && options.adminPassword ? {
    email: options.adminEmail, password: options.adminPassword, name: options.adminName ?? 'Administrator',
  } : undefined);
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', (address: string) => isLoopback(address));
  const secure = publicOrigin.protocol === 'https:';
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure, path: `${prefix}/`, maxAge: sessionLifetime };
  const dummySecret = hashPassword(randomBytes(32).toString('hex'));
  function actor(req: Request) {
    const tokens = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith('rd_team_session='));
    if (tokens.length !== 1 || !/^rd_team_session=[a-f0-9]{64}$/.test(tokens[0])) throw new TeamError('UNAUTHENTICATED', 'Sign in required', 401);
    return store.authenticate(tokens[0].slice('rd_team_session='.length));
  }
  function cookieToken(req: Request) {
    const value = (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => /^rd_team_session=[a-f0-9]{64}$/.test(part));
    return value?.slice('rd_team_session='.length);
  }
  function send<T>(res: Response, result: { status: number; data: T }) { res.status(result.status).json(result.data); }
  function write<T>(req: Request, res: Response, status: number, authorize: (user: TeamUser) => void, mutate: (user: TeamUser) => T) {
    const user = actor(req); const input = body(req); const operationId = validate.operationId(input.operationId);
    send(res, store.write(user, operationId, `${req.method} ${req.path}`, input, status, () => authorize(user), () => mutate(user)));
  }
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    if (secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    const host = req.headers.host;
    let matchesHost = false;
    try {
      if (host && /^[A-Za-z0-9.\[\]:-]+$/.test(host)) matchesHost = new URL(`${publicOrigin.protocol}//${host}`).host.toLowerCase() === publicOrigin.host.toLowerCase();
    } catch { /* Rejected below. */ }
    const documentNavigation = ['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    const publicPage = [prefix || '/', `${prefix}/`, `${prefix}/team`].includes(req.path) || req.path.startsWith(`${prefix}/team/`);
    const publicNavigation = documentNavigation && publicPage;
    if (!matchesHost || (req.headers.origin && req.headers.origin !== publicOrigin.origin) || (!publicNavigation && ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site'])))) {
      return next(new TeamError('ORIGIN_FORBIDDEN', 'Request origin is not allowed', 403));
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) return next(new TeamError('INVALID_INPUT', 'Use application/json for write requests', 415));
    next();
  });
  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(express.json({ limit: '16mb', strict: true, inflate: false }));
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.post('/auth/login', (req, res) => {
    const input = body(req); const accountEmail = validate.email(input.email);
    if (typeof input.password !== 'string' || input.password.length > 128) throw new TeamError('INVALID_INPUT', 'Password must be text of at most 128 characters');
    const address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const keys = [{ key: digest(`account:${accountEmail}`), limit: 10 }, { key: digest(`ip:${address}`), limit: 50 }]; const now = Date.now();
    for (const { key } of keys) {
      const row = store.get('SELECT blocked_until FROM login_attempts WHERE key=?', key);
      if (row && Number(row.blocked_until) > now) { res.set('Retry-After', '900'); throw new TeamError('LOGIN_RATE_LIMIT', 'Too many login attempts; try again later', 429); }
    }
    const row = store.get('SELECT * FROM users WHERE email=?', accountEmail);
    const matches = verifyPassword(input.password, String(row?.password_salt ?? dummySecret.salt), String(row?.password_hash ?? dummySecret.hash));
    if (!row || !matches) {
      store.transaction(() => {
        for (const { key, limit } of keys) {
          const previous = store.get('SELECT * FROM login_attempts WHERE key=?', key);
          const fresh = !previous || now - Number(previous.window_start) > 15 * 60 * 1000;
          const failures = fresh ? 1 : Number(previous.failures) + 1;
          store.run(`INSERT INTO login_attempts(key,failures,window_start,blocked_until) VALUES(?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start,blocked_until=excluded.blocked_until`,
            key, failures, fresh ? now : Number(previous!.window_start), failures >= limit ? now + 15 * 60 * 1000 : 0);
        }
      });
      throw new TeamError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    }
    const token = randomBytes(32).toString('hex'); const user = store.user(row);
    store.transaction(() => {
      store.run('DELETE FROM sessions WHERE expires_at<=?', now);
      store.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', digest(token), user.id, now + sessionLifetime);
      store.run('DELETE FROM login_attempts WHERE key=?', keys[0].key);
      store.audit(null, 'auth.login', user.id, 'Session issued', user.id);
    });
    res.cookie('rd_team_session', token, cookieOptions).json({ user });
  });
  api.get('/auth/me', (req, res) => res.json({ user: actor(req) }));
  api.post('/auth/logout', (req, res) => {
    const user = actor(req); const token = cookieToken(req)!;
    store.transaction(() => { store.run('DELETE FROM sessions WHERE token_hash=?', digest(token)); store.audit(null, 'auth.logout', user.id, 'Session revoked', user.id); });
    res.clearCookie('rd_team_session', cookieOptions).json({});
  });
  api.post('/auth/password', (req, res) => {
    const user = actor(req); const input = body(req); const next = validate.password(input.password);
    if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128) throw new TeamError('INVALID_INPUT', 'Current password required');
    store.transaction(() => {
      const row = store.get('SELECT password_hash,password_salt FROM users WHERE id=?', user.id)!;
      if (!verifyPassword(input.currentPassword as string, String(row.password_salt), String(row.password_hash))) throw new TeamError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
      const secret = hashPassword(next);
      store.run('UPDATE users SET password_hash=?,password_salt=? WHERE id=?', secret.hash, secret.salt, user.id);
      store.run('DELETE FROM sessions WHERE user_id=?', user.id); store.audit(null, 'auth.password_changed', user.id, 'Password changed; all sessions revoked', user.id);
    });
    res.clearCookie('rd_team_session', cookieOptions).json({});
  });
  api.get('/users', (req, res) => {
    const user = actor(req); administrator(user);
    res.json({ users: store.all('SELECT id,email,name,admin FROM users ORDER BY name,email').map(row => store.user(row)) });
  });
  api.post('/users', (req, res) => write(req, res, 201, administrator, user => {
    const input = body(req); const created = store.addUser(validate.email(input.email), validate.text(input.name, 'Name', 160, true), validate.password(input.password));
    store.audit(null, 'user.created', created.id, `Account ${created.email} created`, user.id); return { user: created };
  }));
  api.get('/projects', (req, res) => {
    const user = actor(req);
    res.json({ projects: store.all(`SELECT projects.id FROM projects JOIN memberships ON memberships.project_id=projects.id
      WHERE memberships.user_id=? ORDER BY projects.updated_at DESC,projects.id`, user.id).map(row => store.project(String(row.id), user.id)) });
  });
  api.post('/projects', (req, res) => write(req, res, 201, () => {}, user => {
    const input = body(req); const id = randomUUID(); const now = timestamp();
    const name = validate.text(input.name, 'Project name', 160, true); const description = validate.text(input.description ?? '', 'Project description', 6000);
    store.run('INSERT INTO projects(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)', id, name, description, now, now);
    store.run('INSERT INTO memberships(project_id,user_id,role) VALUES(?,?,?)', id, user.id, 'owner');
    store.audit(id, 'project.created', id, `Project ${name} created`, user.id); return { project: store.project(id, user.id) };
  }));
  api.get('/projects/:id', (req, res) => { const user = actor(req); res.json(store.detail(String(req.params.id), user.id)); });
  api.post('/projects/:id/members', (req, res) => {
    const projectId = String(req.params.id);
    write(req, res, 200, user => { store.role(projectId, user.id, ['owner']); }, user => {
      const input = body(req); const accountEmail = validate.email(input.email); const role = input.role as TeamRole;
      if (!['owner', 'designer', 'reviewer', 'viewer'].includes(role)) throw new TeamError('INVALID_INPUT', 'Invalid project role');
      const row = store.get('SELECT id,email,name,admin FROM users WHERE email=?', accountEmail);
      if (!row) throw new TeamError('NOT_FOUND', 'Create this account before adding a project member', 404);
      const member = store.user(row);
      const existing = store.get('SELECT role FROM memberships WHERE project_id=? AND user_id=?', projectId, member.id);
      if (existing?.role === 'owner' && role !== 'owner' && Number(store.get("SELECT COUNT(*) AS count FROM memberships WHERE project_id=? AND role='owner'", projectId)!.count) <= 1) throw new TeamError('LAST_OWNER', 'A project must keep at least one owner', 409);
      store.run('INSERT INTO memberships(project_id,user_id,role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role', projectId, member.id, role);
      store.audit(projectId, 'member.updated', member.id, `${member.name}: ${existing?.role ?? 'new'} → ${role}`, user.id);
      return { member: { user: member, role } };
    });
  });
  api.post('/projects/:id/versions', (req, res) => {
    const projectId = String(req.params.id);
    write(req, res, 201, user => { store.role(projectId, user.id, ['owner', 'designer']); }, user => {
      const value = validate.versionInput(req.body); const id = randomUUID();
      const number = Number(store.get('SELECT COALESCE(MAX(number),0) AS number FROM versions WHERE project_id=?', projectId)!.number) + 1;
      const contentHash = digest(canonical({ projectId, ...value }));
      store.run(`INSERT INTO versions(id,project_id,number,title,summary,image_data_url,width,height,source_url,layers_json,diff,evidence_json,
        content_hash,status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, projectId, number, value.title, value.summary, value.imageDataUrl, value.width, value.height, value.sourceUrl ?? null,
        JSON.stringify(value.layers), value.diff, JSON.stringify(value.evidence), contentHash, 'draft', timestamp(), user.id);
      store.audit(projectId, 'version.created', id, `v${number}: ${value.title}; hash ${contentHash}`, user.id);
      return { version: store.version(store.versionRow(projectId, id)) };
    });
  });
  api.post('/projects/:id/versions/:versionId/submit', (req, res) => {
    const projectId = String(req.params.id), versionId = String(req.params.versionId);
    write(req, res, 200, user => { store.role(projectId, user.id, ['owner', 'designer']); store.versionRow(projectId, versionId); }, user => {
      const row = store.versionRow(projectId, versionId); store.checkRevision(row, validate.expectedHash(body(req).expectedHash));
      if (row.status !== 'draft') throw new TeamError('STATE_CONFLICT', 'Only a draft version can be submitted; publish a new version after changes are requested', 409);
      store.run("UPDATE versions SET status='in_review',submitted_by=?,submitted_at=? WHERE id=?", user.id, timestamp(), versionId);
      store.audit(projectId, 'version.submitted', versionId, `v${row.number} submitted; hash ${row.content_hash}`, user.id);
      return { version: store.version(store.versionRow(projectId, versionId)) };
    });
  });
  api.post('/projects/:id/versions/:versionId/decision', (req, res) => {
    const projectId = String(req.params.id), versionId = String(req.params.versionId);
    write(req, res, 200, user => {
      store.role(projectId, user.id, ['owner', 'reviewer']); const row = store.versionRow(projectId, versionId);
      if (row.created_by === user.id || row.submitted_by === user.id) throw new TeamError('SELF_REVIEW_FORBIDDEN', 'The creator and submitter cannot review their own design', 403);
    }, user => {
      const input = body(req); const row = store.versionRow(projectId, versionId); store.checkRevision(row, validate.expectedHash(input.expectedHash));
      if (row.status !== 'in_review') throw new TeamError('STATE_CONFLICT', 'Version is no longer awaiting review', 409);
      if (input.decision !== 'approved' && input.decision !== 'changes_requested') throw new TeamError('INVALID_INPUT', 'Review decision must be approved or changes_requested');
      const note = validate.text(input.note ?? '', 'Review note', 6000, input.decision === 'changes_requested');
      store.run('UPDATE versions SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?', input.decision, user.id, timestamp(), note, versionId);
      store.audit(projectId, `version.${input.decision}`, versionId, `v${row.number}; hash ${row.content_hash}; ${note}`, user.id);
      return { version: store.version(store.versionRow(projectId, versionId)) };
    });
  });
  api.post('/projects/:id/comments', (req, res) => {
    const projectId = String(req.params.id);
    write(req, res, 201, user => { store.role(projectId, user.id); }, user => {
      const input = body(req); const versionId = validate.text(input.versionId, 'Version ID', 128, true); store.versionRow(projectId, versionId);
      const text = validate.text(input.text, 'Comment', 6000, true); const anchor = validate.anchor(input.anchor); const id = randomUUID(); const createdAt = timestamp();
      store.run('INSERT INTO comments(id,project_id,version_id,text,anchor_json,author_id,created_at) VALUES(?,?,?,?,?,?,?)',
        id, projectId, versionId, text, anchor ? JSON.stringify(anchor) : null, user.id, createdAt);
      store.audit(projectId, 'comment.created', id, `Comment on ${versionId}`, user.id);
      return { comment: { id, versionId, text, ...(anchor ? { anchor } : {}), createdAt, author: user } };
    });
  });
  api.use((_req, _res, next) => next(new TeamError('NOT_FOUND', 'API endpoint not found', 404)));
  app.use(`${prefix}/api/team`, api);
  app.get([prefix || '/', `${prefix}/`], (_req, res) => res.redirect(302, `${prefix}/team`));
  if (options.staticDirectory && existsSync(options.staticDirectory)) {
    const root = realpathSync(options.staticDirectory);
    const staticFiles = express.static(root, { dotfiles: 'deny', index: false, redirect: false, fallthrough: true,
      setHeaders: response => { response.setHeader('Cache-Control', 'public, max-age=3600'); } });
    app.use(prefix || '/', (req, res, next) => {
      let pathname: string; try { pathname = decodeURIComponent(req.path); } catch { return next(); }
      if (!pathname.startsWith('/assets/') && !['/favicon.ico', '/favicon.svg'].includes(pathname)) return next();
      if (pathname.split('/').some(part => part === '..' || part === '.' || part.startsWith('.')) || pathname.includes('\\') || pathname.includes('\0')) return next();
      const candidate = path.resolve(root, `.${pathname}`);
      if (!candidate.startsWith(root + path.sep) || !existsSync(candidate)) return next();
      const resolved = realpathSync(candidate);
      if (!resolved.startsWith(root + path.sep) || !statSync(resolved).isFile()) return next();
      staticFiles(req, res, next);
    });
    app.get(`${prefix}/team{/*rest}`, (_req, res) => {
      const index = path.join(root, 'index.html');
      if (!existsSync(index) || !realpathSync(index).startsWith(root + path.sep)) throw new TeamError('NOT_FOUND', 'Team workspace is unavailable', 404);
      res.set('Cache-Control', 'no-store').sendFile('index.html', { root, dotfiles: 'deny' });
    });
  }
  app.use((_req, _res, next) => next(new TeamError('NOT_FOUND', 'Page not found', 404)));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof TeamError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error?.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request exceeds upload limit' } });
    if (error?.type === 'entity.parse.failed' || error?.type === 'encoding.unsupported' || error?.type === 'charset.unsupported') return void res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Valid uncompressed JSON required' } });
    console.error('Team service request failed', error instanceof Error ? error.name : 'Unknown error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } });
  };
  app.use(errorHandler);
  return { app, store, close: () => store.close() };
}
