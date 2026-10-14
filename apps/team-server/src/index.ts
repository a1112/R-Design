import path from 'node:path';
import { createTeamApp, validateBind } from './server';

const host = process.env.RDESIGN_TEAM_HOST ?? '127.0.0.1';
const port = Number(process.env.RDESIGN_TEAM_PORT ?? 4315);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RDESIGN_TEAM_PORT must be a valid TCP port');
validateBind(host, process.env.RDESIGN_TEAM_PUBLIC_ORIGIN);
const service = createTeamApp({
  dataDirectory: process.env.RDESIGN_TEAM_DATA_DIR ?? path.resolve('.rdesign/team'),
  publicOrigin: process.env.RDESIGN_TEAM_PUBLIC_ORIGIN ?? `http://${host === '::1' ? '[::1]' : host}:${port}`,
  basePath: process.env.RDESIGN_TEAM_BASE_PATH ?? '',
  staticDirectory: process.env.RDESIGN_TEAM_STATIC_DIR ?? path.resolve('dist/workbench'),
  adminEmail: process.env.RDESIGN_TEAM_ADMIN_EMAIL,
  adminPassword: process.env.RDESIGN_TEAM_ADMIN_PASSWORD,
  adminName: process.env.RDESIGN_TEAM_ADMIN_NAME,
});
const server = service.app.listen(port, host, () => console.log(`R-Design team service listening on ${host}:${port}`));
let closing = false;
function close() {
  if (closing) return; closing = true;
  server.close(() => { service.close(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); service.close(); process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', close); process.on('SIGINT', close);
server.on('error', error => { service.close(); console.error('Unable to start team service:', error.message); process.exitCode = 1; });
