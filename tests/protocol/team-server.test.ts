import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createTeamApp, isLoopback, validateBind, validatePublicOrigin } from '../../apps/team-server/src/server';
import { canonical } from '../../apps/team-server/src/store';
import type { TeamProject, TeamUser, TeamVersion } from '../../packages/team-protocol/src/index';

const password = 'team-test-password-2026';
const host = '127.0.0.1:4315';
const origin = `http://${host}`;
const directories: string[] = [];
const servers: Server[] = [];
const apps: ReturnType<typeof createTeamApp>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  apps.splice(0).forEach(app => app.close());
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width = 1, height = 1) {
  function chunk(type: string, data: Buffer) {
    const name = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height); pixels[1] = 255;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
function animatedPng() {
  function chunk(type: string, data: Buffer) {
    const bytes = Buffer.concat([Buffer.from(type), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(bytes)); return Buffer.concat([size, bytes, crc]);
  }
  const original = Buffer.from(png().split(',')[1], 'base64');
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  function frame(sequence: number) {
    const value = Buffer.alloc(26); value.writeUInt32BE(sequence); value.writeUInt32BE(1, 4); value.writeUInt32BE(1, 8);
    value.writeUInt16BE(1, 20); value.writeUInt16BE(10, 22); return chunk('fcTL', value);
  }
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  return 'data:image/png;base64,' + Buffer.concat([original.subarray(0, 33), chunk('acTL', control), frame(0),
    original.subarray(33, -12), frame(1), chunk('fdAT', Buffer.concat([sequence, deflateSync(Buffer.from([0, 0, 0, 255, 255]))])), original.subarray(-12)]).toString('base64');
}
async function rawRequest(port: number, pathname: string, options: { method?: string; headers: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; headers: Headers; text: () => Promise<string>; json: () => Promise<any> }>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET', headers: options.headers }, async response => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of response) chunks.push(Buffer.from(chunk));
        const contents = Buffer.concat(chunks).toString('utf8'); const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
        }
        resolve({ status: response.statusCode!, headers, text: async () => contents, json: async () => JSON.parse(contents) });
      } catch (error) { reject(error); }
    });
    request.on('error', reject); request.end(options.body);
  });
}

async function fixture(options: { directory?: string; basePath?: string; staticDirectory?: string; publicOrigin?: string } = {}) {
  const directory = options.directory ?? await mkdtemp(path.join(os.tmpdir(), 'rd-team-'));
  if (!options.directory) directories.push(directory);
  const service = createTeamApp({ dataDirectory: directory, publicOrigin: options.publicOrigin ?? origin,
    adminEmail: 'owner@example.test', adminPassword: password, adminName: 'Owner', ...options });
  apps.push(service);
  const server = createServer(service.app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const port = address.port;
  const prefix = options.basePath ?? '';
  async function request(url: string, body?: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
    const response = await rawRequest(port, `${prefix}/api/team${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Host: options.publicOrigin ? new URL(options.publicOrigin).host : host,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: options.publicOrigin ?? origin }),
        ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : { unexpectedBody: await response.text() };
    return { status: response.status, data, headers: response.headers };
  }
  async function login(email = 'owner@example.test', secret = password) {
    const result = await request('/auth/login', { email, password: secret });
    expect(result.status).toBe(200);
    const cookie = result.headers.get('set-cookie')?.split(';')[0]; expect(cookie).toBeTruthy();
    return { cookie: cookie!, user: result.data.user as TeamUser };
  }
  async function user(cookie: string, email: string) {
    const result = await request('/users', { email, name: email.split('@')[0], password, operationId: randomUUID() }, cookie);
    expect(result.status).toBe(201); return result.data.user as TeamUser;
  }
  async function project(cookie: string, name = 'Project A') {
    const result = await request('/projects', { name, description: 'Design approval', operationId: randomUUID() }, cookie);
    expect(result.status).toBe(201); return result.data.project as TeamProject;
  }
  async function member(cookie: string, id: string, email: string, role: string) {
    const result = await request(`/projects/${id}/members`, { email, role, operationId: randomUUID() }, cookie);
    expect(result.status).toBe(200);
  }
  async function version(cookie: string, id: string, extra = {}) {
    const result = await request(`/projects/${id}/versions`, { title: 'Login design', summary: 'Spacing changed',
      imageDataUrl: png(), layers: [{ id: 'button', name: 'Submit', bounds: { x: 0, y: 0, w: 1, h: 1 } }],
      diff: 'Button spacing: 8 → 12', evidence: [{ name: 'visual', passed: true, detail: 'Verified locally' }],
      operationId: randomUUID(), ...extra }, cookie);
    expect(result.status).toBe(201); return result.data.version as TeamVersion;
  }
  return { directory, service, server, address, request, login, user, project, member, version };
}

describe('team control plane', () => {
  it('recognizes only actual loopback IP addresses and rejects deceptively named HTTP hosts', () => {
    for (const address of ['localhost', '127.0.0.1', '127.255.1.3', '::1', '::ffff:127.0.0.1']) expect(isLoopback(address)).toBe(true);
    for (const address of ['127.evil.example', '127.0.0.1.evil', '127.999.1.1', '::ffff:127.evil', 'localhost.evil', '0.0.0.0']) expect(isLoopback(address)).toBe(false);
    expect(() => validatePublicOrigin('http://127.evil.example')).toThrow();
    expect(() => validateBind('127.evil.example', undefined)).toThrow();
    expect(() => validateBind('0.0.0.0', undefined)).toThrow();
    expect(() => validateBind('0.0.0.0', 'https://design.example.test')).not.toThrow();
  });
  it('bootstraps a password-hashed administrator and issues hashed HttpOnly sessions', async () => {
    const f = await fixture();
    expect((await f.request('/health')).data).toEqual({ status: 'ok' });
    expect((await f.request('/auth/me')).status).toBe(401);
    const login = await f.login();
    expect(login.user).toMatchObject({ email: 'owner@example.test', name: 'Owner', admin: true });
    expect(login.user).not.toHaveProperty('password');
    expect((await f.request('/auth/me', undefined, login.cookie)).data.user).toEqual(login.user);
    const db = new DatabaseSync(path.join(f.directory, 'team.sqlite'));
    const session = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    expect(session.token_hash).not.toContain(login.cookie.split('=')[1]);
    const diskUser = db.prepare('SELECT password_hash, password_salt FROM users').get() as Record<string, string>;
    expect(diskUser.password_hash).not.toEqual(password); expect(diskUser.password_salt).toHaveLength(32); db.close();
    const response = await f.request('/auth/login', { email: login.user.email, password });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
  });

  it('isolates projects and rejects viewers from all design writes', async () => {
    const f = await fixture(); const owner = await f.login();
    await f.user(owner.cookie, 'viewer@example.test'); await f.user(owner.cookie, 'outsider@example.test');
    const project = await f.project(owner.cookie); await f.member(owner.cookie, project.id, 'viewer@example.test', 'viewer');
    const viewer = await f.login('viewer@example.test'); const outsider = await f.login('outsider@example.test');
    const other = await f.project(outsider.cookie, 'Project B');
    expect((await f.request('/projects', undefined, viewer.cookie)).data.projects.map((p: TeamProject) => p.id)).toEqual([project.id]);
    expect((await f.request(`/projects/${other.id}`, undefined, owner.cookie)).status).toBe(403);
    expect((await f.request(`/projects/${project.id}`, undefined, outsider.cookie)).status).toBe(403);
    expect((await f.request(`/projects/${project.id}/versions`, { operationId: randomUUID(), title: 'No', summary: '', imageDataUrl: png() }, viewer.cookie)).status).toBe(403);
    expect((await f.request(`/projects/${project.id}/members`, { operationId: randomUUID(), email: outsider.user.email, role: 'owner' }, viewer.cookie)).status).toBe(403);
    expect((await f.request('/users', undefined, viewer.cookie)).status).toBe(403);
    expect((await f.request('/users', { email: 'elevated@example.test', name: 'No admin', password, admin: true, operationId: randomUUID() }, viewer.cookie)).status).toBe(403);
    const ordinary = await f.request('/users', { email: 'ordinary@example.test', name: 'Ordinary', password, admin: true, operationId: randomUUID() }, owner.cookie);
    expect(ordinary.data.user.admin).toBe(false);
  });

  it('requires independent reviewers and binds decisions to the submitted hash', async () => {
    const f = await fixture(); const owner = await f.login(); await f.user(owner.cookie, 'designer@example.test'); await f.user(owner.cookie, 'reviewer@example.test');
    const p = await f.project(owner.cookie); await f.member(owner.cookie, p.id, 'designer@example.test', 'designer'); await f.member(owner.cookie, p.id, 'reviewer@example.test', 'reviewer');
    const designer = await f.login('designer@example.test'); const reviewer = await f.login('reviewer@example.test');
    const v = await f.version(designer.cookie, p.id);
    expect(v).toMatchObject({ width: 1, height: 1, status: 'draft', createdBy: designer.user });
    const submit = await f.request(`/projects/${p.id}/versions/${v.id}/submit`, { expectedHash: v.contentHash, operationId: randomUUID() }, designer.cookie);
    expect(submit.data.version).toMatchObject({ status: 'in_review', submittedBy: designer.user });
    const body = { decision: 'approved', note: 'Accepted', expectedHash: v.contentHash, operationId: randomUUID() };
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, designer.cookie)).status).toBe(403);
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, { ...body, expectedHash: '0'.repeat(64) }, reviewer.cookie)).status).toBe(409);
    const decision = await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, reviewer.cookie);
    expect(decision.status).toBe(200); expect(decision.data.version).toMatchObject({ status: 'approved', decidedBy: reviewer.user, decisionNote: 'Accepted' });
    expect((await f.request(`/projects/${p.id}`, undefined, owner.cookie)).data.activity.map((a: { action: string }) => a.action)).toContain('version.approved');
  });

  it('rejects owner self-review and cannot approve an older pending version', async () => {
    const f = await fixture(); const owner = await f.login(); await f.user(owner.cookie, 'reviewer@example.test');
    const p = await f.project(owner.cookie); await f.member(owner.cookie, p.id, 'reviewer@example.test', 'reviewer'); const reviewer = await f.login('reviewer@example.test');
    const v = await f.version(owner.cookie, p.id);
    await f.request(`/projects/${p.id}/versions/${v.id}/submit`, { expectedHash: v.contentHash, operationId: randomUUID() }, owner.cookie);
    const decide = { decision: 'changes_requested', note: 'Retest', expectedHash: v.contentHash, operationId: randomUUID() };
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, decide, owner.cookie)).status).toBe(403);
    await f.version(owner.cookie, p.id, { title: 'Next version' });
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, decide, reviewer.cookie)).status).toBe(409);
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/submit`, { expectedHash: v.contentHash, operationId: randomUUID() }, owner.cookie)).status).toBe(409);
  });

  it('serializes independent reviewer decisions so one mutation and audit event survive', async () => {
    const f = await fixture(); const owner = await f.login();
    for (const email of ['reviewer@example.test', 'reviewer2@example.test']) await f.user(owner.cookie, email);
    const p = await f.project(owner.cookie);
    for (const email of ['reviewer@example.test', 'reviewer2@example.test']) await f.member(owner.cookie, p.id, email, 'reviewer');
    const v = await f.version(owner.cookie, p.id); await f.request(`/projects/${p.id}/versions/${v.id}/submit`, { expectedHash: v.contentHash, operationId: randomUUID() }, owner.cookie);
    const r1 = await f.login('reviewer@example.test'); const r2 = await f.login('reviewer2@example.test');
    const responses = await Promise.all([r1, r2].map(r => f.request(`/projects/${p.id}/versions/${v.id}/decision`, { decision: 'approved', note: 'Looks good', expectedHash: v.contentHash, operationId: randomUUID() }, r.cookie)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const detail = (await f.request(`/projects/${p.id}`, undefined, owner.cookie)).data;
    expect(detail.activity.filter((a: { action: string }) => a.action === 'version.approved')).toHaveLength(1);
  });

  it('stores immutable content, comments, and receipts across restart without duplicate audit', async () => {
    const f = await fixture(); const owner = await f.login(); const p = await f.project(owner.cookie);
    const operationId = randomUUID(); const body = { operationId, title: 'Immutable', summary: 'Trace', imageDataUrl: png() };
    const first = await f.request(`/projects/${p.id}/versions`, body, owner.cookie);
    const duplicate = await f.request(`/projects/${p.id}/versions`, body, owner.cookie);
    expect(duplicate.status).toBe(201); expect(duplicate.data).toEqual(first.data);
    expect((await f.request(`/projects/${p.id}/versions`, { ...body, title: 'Mutated' }, owner.cookie)).status).toBe(409);
    const comment = await f.request(`/projects/${p.id}/comments`, { versionId: first.data.version.id, text: 'Align this button', anchor: { x: 0.25, y: 0.75 }, operationId: randomUUID(), author: { id: 'spoof' } }, owner.cookie);
    expect(comment.status).toBe(201); expect(comment.data.comment.author).toEqual(owner.user);
    await new Promise<void>(resolve => { f.server.closeAllConnections(); f.server.close(() => resolve()); }); servers.splice(servers.indexOf(f.server), 1); f.service.close(); apps.splice(apps.indexOf(f.service), 1);
    const reopened = await fixture({ directory: f.directory });
    expect((await reopened.request('/auth/me', undefined, owner.cookie)).data.user).toEqual(owner.user);
    expect((await reopened.request(`/projects/${p.id}/versions`, body, owner.cookie)).data).toEqual(first.data);
    const detail = (await reopened.request(`/projects/${p.id}`, undefined, owner.cookie)).data;
    expect(detail.versions).toHaveLength(1); expect(detail.comments).toHaveLength(1);
    expect(detail.activity.filter((a: { action: string }) => a.action === 'version.created')).toHaveLength(1);
    expect((await reopened.login()).user).toEqual(owner.user);
  });

  it('rechecks permission even for successful operation replays', async () => {
    const f = await fixture(); const owner = await f.login(); await f.user(owner.cookie, 'designer@example.test');
    const p = await f.project(owner.cookie); await f.member(owner.cookie, p.id, 'designer@example.test', 'designer'); const designer = await f.login('designer@example.test');
    const body = { operationId: randomUUID(), title: 'Before downgrade', summary: '', imageDataUrl: png() };
    expect((await f.request(`/projects/${p.id}/versions`, body, designer.cookie)).status).toBe(201);
    await f.member(owner.cookie, p.id, designer.user.email, 'viewer');
    expect((await f.request(`/projects/${p.id}/versions`, body, designer.cookie)).status).toBe(403);
  });

  it('uses costly salted receipts for password-bearing writes without losing replay or collision checks', async () => {
    const f = await fixture(); const owner = await f.login();
    const body = { email: 'receipt@example.test', name: 'Receipt User', password, operationId: randomUUID() };
    const first = await f.request('/users', body, owner.cookie); expect(first.status).toBe(201);
    const db = new DatabaseSync(path.join(f.directory, 'team.sqlite'));
    const row = db.prepare('SELECT signature FROM receipts WHERE actor_id=? AND operation_id=?').get(owner.user.id, body.operationId) as { signature: string };
    const userSecret = db.prepare('SELECT password_salt FROM users WHERE email=?').get(body.email) as { password_salt: string };
    db.close();
    const cheapGuess = createHash('sha256').update(canonical({ route: 'POST /users', body })).digest('hex');
    expect(row.signature).not.toEqual(cheapGuess);
    expect(row.signature).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(row.signature.split(':')[1]).not.toBe(userSecret.password_salt);
    expect((await f.request('/users', body, owner.cookie)).data).toEqual(first.data);
    expect((await f.request('/users', { ...body, password: 'other-team-password-2026' }, owner.cookie)).status).toBe(409);
  });

  it('rejects spoofed images, corrupted PNG data, executable URLs, and invalid layer geometry', async () => {
    const f = await fixture(); const owner = await f.login(); const p = await f.project(owner.cookie);
    const valid = { operationId: randomUUID(), title: 'Safe evidence', summary: '', imageDataUrl: png() };
    const invalids = [
      { imageDataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64') },
      { imageDataUrl: 'data:image/png;base64,' + Buffer.from('<html>not raster</html>').toString('base64') },
      { imageDataUrl: valid.imageDataUrl.slice(0, -8) },
      { imageDataUrl: png(8193, 1) },
      { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'http://localhost:3000' },
      { layers: [{ id: 'bad', name: 'Layer', bounds: { x: 0, y: 0, w: -1, h: 1 } }] },
      { layers: [{ id: 'bad', name: 'Layer', bounds: { x: '1', y: 0, w: 1, h: 1 } }] },
      { evidence: [{ name: 'proof', passed: 'true', detail: 'invalid' }] },
    ];
    for (const extra of invalids) expect((await f.request(`/projects/${p.id}/versions`, { ...valid, operationId: randomUUID(), ...extra }, owner.cookie)).status).toBe(400);
    expect((await f.request(`/projects/${p.id}`, undefined, owner.cookie)).data.versions).toHaveLength(0);
  });

  it('rejects animated PNG so an approved screenshot does not change frames over time', async () => {
    const f = await fixture(); const owner = await f.login(); const p = await f.project(owner.cookie);
    const result = await f.request(`/projects/${p.id}/versions`, {
      operationId: randomUUID(), title: 'Animated evidence', summary: '', imageDataUrl: animatedPng(),
    }, owner.cookie);
    expect(result.status).toBe(400);
    expect((await f.request(`/projects/${p.id}`, undefined, owner.cookie)).data.versions).toHaveLength(0);
  });

  it('revokes all sessions on password change and logout revocation persists', async () => {
    const f = await fixture(); const one = await f.login(); const two = await f.login();
    const change = await f.request('/auth/password', { currentPassword: password, password: 'new-team-password-2026' }, one.cookie);
    expect(change.status).toBe(200);
    expect((await f.request('/auth/me', undefined, one.cookie)).status).toBe(401);
    expect((await f.request('/auth/me', undefined, two.cookie)).status).toBe(401);
    expect((await f.request('/auth/login', { email: one.user.email, password })).status).toBe(401);
    const next = await f.login(one.user.email, 'new-team-password-2026');
    expect((await f.request('/auth/logout', {}, next.cookie)).status).toBe(200);
    expect((await f.request('/auth/me', undefined, next.cookie)).status).toBe(401);
  });

  it('rejects cross-origin or forged host requests and sets secure cookies behind loopback HTTPS proxy', async () => {
    const f = await fixture({ publicOrigin: 'https://design.example.test', basePath: '/r-design' });
    expect((await f.request('/auth/login', { email: 'owner@example.test', password }, undefined, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await f.request('/health', undefined, undefined, { Host: 'attacker.example' })).status).toBe(403);
    expect((await f.request('/health', undefined, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    const login = await f.request('/auth/login', { email: 'owner@example.test', password }, undefined, { 'X-Forwarded-Proto': 'https' });
    expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toContain('Secure');
    expect(login.headers.get('set-cookie')).toContain('Path=/r-design/');
    expect(login.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rate limits login failures without disclosing account existence', async () => {
    const f = await fixture();
    const unknown = await f.request('/auth/login', { email: 'missing@example.test', password });
    const known = await f.request('/auth/login', { email: 'owner@example.test', password: 'wrong-secret-value' });
    expect(unknown.status).toBe(401); expect(known.status).toBe(401); expect(unknown.data).toEqual(known.data);
    const statuses: number[] = [];
    for (let i = 0; i < 18; i++) statuses.push((await f.request('/auth/login', { email: 'owner@example.test', password: 'wrong-secret-value' })).status);
    expect(statuses).toContain(429);
  });

  it('cannot reset account login failure limits by rotating forwarded IP headers', async () => {
    const f = await fixture(); const statuses: number[] = [];
    for (let i = 1; i <= 12; i++) statuses.push((await f.request('/auth/login', {
      email: 'owner@example.test', password: 'wrong-secret-value',
    }, undefined, { 'X-Forwarded-For': `198.51.100.${i}` })).status);
    expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
    expect((await f.request('/auth/login', { email: 'owner@example.test', password }, undefined, { 'X-Forwarded-For': '203.0.113.1' })).status).toBe(429);
  });

  it('prevents demoting the last owner but permits transfer after another owner is appointed', async () => {
    const f = await fixture(); const owner = await f.login(); await f.user(owner.cookie, 'newowner@example.test');
    const p = await f.project(owner.cookie);
    expect((await f.request(`/projects/${p.id}/members`, { email: owner.user.email, role: 'viewer', operationId: randomUUID() }, owner.cookie)).status).toBe(409);
    await f.member(owner.cookie, p.id, 'newowner@example.test', 'owner');
    await f.member(owner.cookie, p.id, owner.user.email, 'viewer');
    expect((await f.request(`/projects/${p.id}`, undefined, owner.cookie)).data.project.role).toBe('viewer');
  });

  it('binds the creator and a different submitting owner against self approval', async () => {
    const f = await fixture(); const owner = await f.login(); await f.user(owner.cookie, 'designer@example.test'); await f.user(owner.cookie, 'reviewer@example.test');
    const p = await f.project(owner.cookie); await f.member(owner.cookie, p.id, 'designer@example.test', 'designer'); await f.member(owner.cookie, p.id, 'reviewer@example.test', 'reviewer');
    const designer = await f.login('designer@example.test'); const reviewer = await f.login('reviewer@example.test'); const v = await f.version(designer.cookie, p.id);
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/submit`, { expectedHash: v.contentHash, operationId: randomUUID() }, owner.cookie)).status).toBe(200);
    const body = { decision: 'approved', note: '', expectedHash: v.contentHash, operationId: randomUUID() };
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, owner.cookie)).status).toBe(403);
    const accepted = await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, reviewer.cookie);
    expect(accepted.status).toBe(200);
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, reviewer.cookie)).data).toEqual(accepted.data);
    await f.member(owner.cookie, p.id, reviewer.user.email, 'viewer');
    expect((await f.request(`/projects/${p.id}/versions/${v.id}/decision`, body, reviewer.cookie)).status).toBe(403);
  });

  it('rejects expired persisted sessions and does not expose unsupported mutations', async () => {
    const f = await fixture(); const owner = await f.login(); const p = await f.project(owner.cookie); const v = await f.version(owner.cookie, p.id);
    expect((await f.request(`/projects/${p.id}/versions/${v.id}`, { title: 'Replace audit image' }, owner.cookie)).status).toBe(404);
    const db = new DatabaseSync(path.join(f.directory, 'team.sqlite')); db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() - 1); db.close();
    expect((await f.request('/auth/me', undefined, owner.cookie)).status).toBe(401);
  });

  it('serves the team deep link while refusing source, database, and directory traversal', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-team-static-')); directories.push(directory);
    const staticDirectory = path.join(directory, 'dist'); await mkdir(path.join(staticDirectory, 'assets'), { recursive: true });
    await writeFile(path.join(staticDirectory, 'index.html'), '<html>Team workspace</html>');
    await writeFile(path.join(staticDirectory, 'assets', 'app.js'), 'window.ready=true');
    await writeFile(path.join(directory, 'secret.txt'), 'not public');
    const f = await fixture({ basePath: '/r-design', staticDirectory });
    async function raw(url: string) { return rawRequest(f.address.port, url, { headers: { Host: host } }); }
    expect((await raw('/r-design')).headers.get('location')).toBe('/r-design/team');
    expect(await (await raw('/r-design/team/projects/project-id')).text()).toContain('Team workspace');
    expect((await raw('/r-design/assets/app.js')).status).toBe(200);
    const navigation = await rawRequest(f.address.port, '/r-design/team', {
      headers: { Host: host, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
    });
    expect(navigation.status).toBe(200); expect(await navigation.text()).toContain('Team workspace');
    expect((await f.request('/auth/login', { email: 'owner@example.test', password }, undefined, {
      'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
    })).status).toBe(403);
    for (const url of ['/r-design/apps/team-server/src/server.ts', '/r-design/team.sqlite', '/r-design/assets/%2e%2e/%2e%2e/secret.txt']) {
      const response = await raw(url); expect(response.status).toBe(404); expect(await response.text()).not.toContain('not public');
    }
    expect((await readFile(path.join(f.directory, 'team.sqlite'))).length).toBeGreaterThan(0);
  });

  it('rejects a private data directory inside a static directory reached through a junction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-team-junction-')); directories.push(directory);
    const actualStatic = path.join(directory, 'public'); const dataDirectory = path.join(actualStatic, 'assets');
    const linkedStatic = path.join(directory, 'public-link');
    await mkdir(dataDirectory, { recursive: true }); await symlink(actualStatic, linkedStatic, 'junction');
    expect(() => {
      const service = createTeamApp({ dataDirectory, staticDirectory: linkedStatic, publicOrigin: origin,
        adminEmail: 'owner@example.test', adminPassword: password, adminName: 'Owner' });
      apps.push(service);
    }).toThrow('cannot be inside');
  });

  it('serves an explicitly authorized static root beneath a hidden parent without exposing private files or escaping links', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rd-team-hidden-parent-')); directories.push(directory);
    const staticDirectory = path.join(directory, '.private-parent', 'public');
    const secretDirectory = path.join(directory, 'private-data');
    await mkdir(path.join(staticDirectory, 'assets'), { recursive: true }); await mkdir(secretDirectory);
    await writeFile(path.join(staticDirectory, 'index.html'), '<html>Authorized team workspace</html>');
    await writeFile(path.join(staticDirectory, 'assets', '.hidden.js'), 'private hidden asset');
    await writeFile(path.join(secretDirectory, 'secret.txt'), 'private secret');
    await symlink(secretDirectory, path.join(staticDirectory, 'assets', 'escape'), 'junction');
    const f = await fixture({ staticDirectory });
    const page = await rawRequest(f.address.port, '/team/projects/design', { headers: { Host: host } });
    expect(page.status).toBe(200); expect(await page.text()).toContain('Authorized team workspace');
    for (const url of ['/assets/.hidden.js', '/team.sqlite', '/assets/escape/secret.txt']) {
      const result = await rawRequest(f.address.port, url, { headers: { Host: host } });
      expect(result.status).toBe(404); expect(await result.text()).not.toContain('private secret');
    }
  });
});
