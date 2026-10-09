// Optional Windows/macOS/Linux fallback when Docker is unavailable.
// Install separately: npm install --prefix .local/pg --save-exact embedded-postgres@17.10.0-beta.17
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from '../.local/pg/node_modules/embedded-postgres/dist/index.js';

const directory = fileURLToPath(new URL('../.local/postgres-data', import.meta.url));
const pg = new EmbeddedPostgres({
  databaseDir: directory, user: 'marketory', password: 'marketory_local', port: 55432,
  persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
});
if (!existsSync(`${directory}/PG_VERSION`)) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='marketory'")).rowCount) {
  await pg.createDatabase('marketory');
}
console.log((await client.query('SELECT version()')).rows[0].version);
await client.end();
console.log('Local development DB listening on 127.0.0.1:55432. Stop with Ctrl+C.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
