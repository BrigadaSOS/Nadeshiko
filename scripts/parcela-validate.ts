import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyParcelaTestEnvironment } from '../backend/config/parcela.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PARCELA_PORT_POSTGRES || !process.env.PARCELA_PORT_ELASTICSEARCH) {
  throw new Error('Run it with parcela task validate, against this environment’s own containers');
}
// The children read `.env.test` with --env-file or dotenv, which keep what is already set here.
applyParcelaTestEnvironment(process.env, join(root, 'backend'));
const suites: Record<string, string[]> = {
  parcela: [process.execPath, '--test', 'scripts/parcela.test.mjs'],
  backend: ['npm', 'run', 'test', '--workspace', 'backend'],
  frontend: ['npm', 'run', 'test', '--workspace', 'nuxt-app'],
};
const selected = process.argv[2] ?? 'all';
if (process.argv.length > 3 || (selected !== 'all' && !Object.hasOwn(suites, selected))) {
  throw new Error('Choose all, parcela, backend or frontend');
}
const run = ([command, ...args]: string[], env: NodeJS.ProcessEnv = process.env) => {
  if (!command) throw new Error('Validation command is missing');
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (selected === 'all' || selected === 'backend') {
  // test:setup clears tables but not the functions migrations create, so it cannot run twice on
  // one database. Start the test database over; it lives only in this environment's container.
  const admin = new pg.Client({
    host: process.env.POSTGRES_ADMIN_HOST,
    port: Number(process.env.POSTGRES_ADMIN_PORT),
    user: process.env.POSTGRES_ADMIN_USER,
    password: process.env.POSTGRES_ADMIN_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query('DROP DATABASE IF EXISTS nadeshiko_test WITH (FORCE)');
  } finally {
    await admin.end();
  }
  // Recreates the test database, test user and test index, in this environment's containers.
  run(['npm', 'run', 'test:setup', '--workspace', 'backend']);
}
for (const [name, command] of Object.entries(suites)) {
  if (selected === 'all' || selected === name) run(command);
}
