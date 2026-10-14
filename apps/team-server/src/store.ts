import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { TeamActivity, TeamComment, TeamMember, TeamProject, TeamProjectDetail, TeamRole, TeamUser, TeamVersion } from '../../../packages/team-protocol/src/index';

export class TeamError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
type Row = Record<string, string | number | null>;
type Value = string | number | null;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const timestamp = () => new Date().toISOString();
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex') };
}
export function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function receiptSignature(request: string, body: unknown) {
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'password')) {
    // A cheap digest of a password-bearing request would bypass the user password's scrypt cost.
    const secret = hashPassword(request);
    return `scrypt:${secret.salt}:${secret.hash}`;
  }
  return digest(request);
}
function matchesReceipt(request: string, signature: string) {
  if (signature.startsWith('scrypt:')) {
    const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(signature);
    return !!match && verifyPassword(request, match[1], match[2]);
  }
  return digest(request) === signature;
}

/** Only evidence and workflow metadata live here. No executable source is accepted. */
export class TeamStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;
  constructor(directory: string, bootstrap?: { email: string; name: string; password: string }) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.databasePath = path.join(directory, 'team.sqlite');
    this.db = new DatabaseSync(this.databasePath);
    chmodSync(this.databasePath, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK(role IN ('owner','designer','reviewer','viewer')),
        PRIMARY KEY(project_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL, image_data_url TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        source_url TEXT, layers_json TEXT NOT NULL, diff TEXT NOT NULL, evidence_json TEXT NOT NULL,
        content_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','in_review','approved','changes_requested')),
        created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
        submitted_by TEXT REFERENCES users(id), submitted_at TEXT,
        decided_by TEXT REFERENCES users(id), decided_at TEXT, decision_note TEXT,
        UNIQUE(project_id,number)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version_id TEXT NOT NULL REFERENCES versions(id),
        text TEXT NOT NULL, anchor_json TEXT, author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), action TEXT NOT NULL, subject_id TEXT NOT NULL,
        detail TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_project ON activity(project_id,created_at);
      CREATE TABLE IF NOT EXISTS receipts (
        actor_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL, signature TEXT NOT NULL,
        response_json TEXT NOT NULL, status INTEGER NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id,operation_id)
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS versions_content_immutable
      BEFORE UPDATE OF project_id,number,title,summary,image_data_url,width,height,source_url,layers_json,diff,evidence_json,content_hash,created_at,created_by ON versions
      BEGIN SELECT RAISE(ABORT,'Version content is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON versions
      BEGIN SELECT RAISE(ABORT,'Versions cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity
      BEGIN SELECT RAISE(ABORT,'Audit history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity
      BEGIN SELECT RAISE(ABORT,'Audit history is immutable'); END;
    `);
    try {
      this.transaction(() => {
        if (Number(this.get('SELECT COUNT(*) AS count FROM users')!.count) > 0) return;
        if (!bootstrap) throw new Error('Empty team database requires RDESIGN_TEAM_ADMIN_EMAIL and RDESIGN_TEAM_ADMIN_PASSWORD');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrap.email) || bootstrap.email.length > 254) throw new Error('Invalid bootstrap administrator email');
        if (bootstrap.password.length < 12 || bootstrap.password.length > 128) throw new Error('Bootstrap administrator password must contain 12 to 128 characters');
        if (!bootstrap.name.trim() || bootstrap.name.length > 160) throw new Error('Invalid bootstrap administrator name');
        const user = this.addUser(bootstrap.email.toLowerCase(), bootstrap.name.trim(), bootstrap.password, true);
        this.audit(null, 'user.bootstrapped', user.id, 'Initial administrator created', user.id);
      });
    } catch (error) { this.close(); throw error; }
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  get(sql: string, ...values: Value[]) { return this.statement(sql).get(...values) as Row | undefined; }
  all(sql: string, ...values: Value[]) { return this.statement(sql).all(...values) as Row[]; }
  run(sql: string, ...values: Value[]) { return this.statement(sql).run(...values); }
  transaction<T>(mutate: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = mutate(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { if (!this.closed) { this.closed = true; this.statements.clear(); this.db.close(); } }
  user(row: Row): TeamUser { return { id: String(row.id), email: String(row.email), name: String(row.name), admin: row.admin === 1 }; }
  userById(id: string): TeamUser {
    const row = this.get('SELECT id,email,name,admin FROM users WHERE id=?', id);
    if (!row) throw new TeamError('NOT_FOUND', 'Account not found', 404);
    return this.user(row);
  }
  addUser(email: string, name: string, password: string, admin = false) {
    if (this.get('SELECT id FROM users WHERE email=?', email)) throw new TeamError('EMAIL_EXISTS', 'Account email is already in use', 409);
    const id = randomUUID(); const secret = hashPassword(password);
    this.run('INSERT INTO users(id,email,name,admin,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)',
      id, email, name, admin ? 1 : 0, secret.hash, secret.salt, timestamp());
    return this.userById(id);
  }
  authenticate(token: string): TeamUser {
    const row = this.get(`SELECT users.id,users.email,users.name,users.admin FROM sessions
      JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?`, digest(token), Date.now());
    if (!row) throw new TeamError('UNAUTHENTICATED', 'Sign in required', 401);
    return this.user(row);
  }
  audit(projectId: string | null, action: string, subjectId: string, detail: string, actorId: string) {
    this.run('INSERT INTO activity(id,project_id,action,subject_id,detail,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',
      randomUUID(), projectId, action, subjectId, detail, actorId, timestamp());
    if (projectId) this.run('UPDATE projects SET updated_at=? WHERE id=?', timestamp(), projectId);
  }
  /** Authorization is called inside the transaction, including on receipt replay. */
  write<T>(actor: TeamUser, operationId: string, route: string, body: unknown, status: number, authorize: () => void, mutate: () => T) {
    return this.transaction(() => {
      authorize();
      const request = canonical({ route, body });
      const receipt = this.get('SELECT signature,response_json,status FROM receipts WHERE actor_id=? AND operation_id=?', actor.id, operationId);
      if (receipt) {
        if (!matchesReceipt(request, String(receipt.signature))) throw new TeamError('OPERATION_COLLISION', 'Operation ID was already used with different content', 409);
        return { status: Number(receipt.status), data: JSON.parse(String(receipt.response_json)) as T };
      }
      const data = mutate();
      const signature = receiptSignature(request, body);
      this.run('INSERT INTO receipts(actor_id,operation_id,signature,response_json,status,created_at) VALUES(?,?,?,?,?,?)',
        actor.id, operationId, signature, JSON.stringify(data), status, timestamp());
      return { status, data };
    });
  }
  role(projectId: string, actorId: string, allowed?: TeamRole[]): TeamRole {
    if (!this.get('SELECT id FROM projects WHERE id=?', projectId)) throw new TeamError('NOT_FOUND', 'Project not found', 404);
    const membership = this.get('SELECT role FROM memberships WHERE project_id=? AND user_id=?', projectId, actorId);
    if (!membership || (allowed && !allowed.includes(membership.role as TeamRole))) throw new TeamError('FORBIDDEN', 'Project role does not permit this action', 403);
    return membership.role as TeamRole;
  }
  versionRow(projectId: string, versionId: string) {
    const row = this.get('SELECT * FROM versions WHERE project_id=? AND id=?', projectId, versionId);
    if (!row) throw new TeamError('NOT_FOUND', 'Version not found in this project', 404);
    return row;
  }
  version(row: Row): TeamVersion {
    return {
      id: String(row.id), projectId: String(row.project_id), number: Number(row.number), title: String(row.title), summary: String(row.summary),
      imageDataUrl: String(row.image_data_url), width: Number(row.width), height: Number(row.height),
      ...(row.source_url ? { sourceUrl: String(row.source_url) } : {}),
      layers: JSON.parse(String(row.layers_json)), diff: String(row.diff), evidence: JSON.parse(String(row.evidence_json)),
      contentHash: String(row.content_hash), status: row.status as TeamVersion['status'], createdAt: String(row.created_at), createdBy: this.userById(String(row.created_by)),
      ...(row.submitted_by ? { submittedBy: this.userById(String(row.submitted_by)), submittedAt: String(row.submitted_at) } : {}),
      ...(row.decided_by ? { decidedBy: this.userById(String(row.decided_by)), decidedAt: String(row.decided_at), decisionNote: String(row.decision_note ?? '') } : {}),
    };
  }
  project(projectId: string, actorId: string): TeamProject {
    const role = this.role(projectId, actorId);
    const row = this.get('SELECT * FROM projects WHERE id=?', projectId)!;
    const latest = this.get('SELECT * FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1', projectId);
    return { id: projectId, name: String(row.name), description: String(row.description), role, updatedAt: String(row.updated_at),
      versionCount: Number(this.get('SELECT COUNT(*) AS count FROM versions WHERE project_id=?', projectId)!.count),
      pendingCount: latest?.status === 'in_review' ? 1 : 0, ...(latest ? { latestVersion: this.version(latest) } : {}) };
  }
  detail(projectId: string, actorId: string): TeamProjectDetail {
    const project = this.project(projectId, actorId);
    const members: TeamMember[] = this.all(`SELECT users.id,users.email,users.name,users.admin,memberships.role FROM memberships
      JOIN users ON users.id=memberships.user_id WHERE project_id=? ORDER BY users.name`, projectId).map(row => ({ user: this.user(row), role: row.role as TeamRole }));
    const versions = this.all('SELECT * FROM versions WHERE project_id=? ORDER BY number DESC', projectId).map(row => this.version(row));
    const comments: TeamComment[] = this.all('SELECT * FROM comments WHERE project_id=? ORDER BY created_at,id', projectId).map(row => ({
      id: String(row.id), versionId: String(row.version_id), text: String(row.text),
      ...(row.anchor_json ? { anchor: JSON.parse(String(row.anchor_json)) } : {}), createdAt: String(row.created_at), author: this.userById(String(row.author_id)),
    }));
    const activity: TeamActivity[] = this.all('SELECT * FROM activity WHERE project_id=? ORDER BY created_at DESC,rowid DESC', projectId).map(row => ({
      id: String(row.id), action: String(row.action), subjectId: String(row.subject_id), detail: String(row.detail), createdAt: String(row.created_at), actor: this.userById(String(row.actor_id)),
    }));
    return { project, members, versions, comments, activity };
  }
  checkRevision(row: Row, expectedHash: string) {
    if (row.content_hash !== expectedHash) throw new TeamError('HASH_CONFLICT', 'Design hash changed; reload before continuing', 409);
    const latest = this.get('SELECT id FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1', String(row.project_id));
    if (latest?.id !== row.id) throw new TeamError('STALE_VERSION', 'Only the latest design version can enter or finish review', 409);
  }
}
