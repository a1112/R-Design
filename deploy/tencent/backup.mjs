import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || path.resolve(source) === path.resolve(destination)) {
  throw new Error('Usage: node backup.mjs SOURCE.sqlite DESTINATION.sqlite');
}
await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
const database = new DatabaseSync(source, { readOnly: true });
try {
  await backup(database, destination);
  await chmod(destination, 0o600);
  console.log('Consistent SQLite backup completed.');
} finally {
  database.close();
}
