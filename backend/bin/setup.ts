import { execFileSync } from 'child_process';
import { existsSync, copyFileSync, readFileSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { createInterface } from 'readline';

const SEED_DUMP_PATH = '/tmp/nadeshiko-seed.dump';
const SEED_URL = process.env.SEED_URL || 'https://seed.nadeshiko.co/seed.dump';
const DOCKER_COMPOSE_FILE = 'docker-compose.yaml';
const ES_DOCKERFILE = 'docker/Dockerfile.elasticsearch';
const ES_CONTAINER = 'nadeshiko-elasticsearch';
const ES_DATA_VOLUME = 'backend_nadeshiko_elasticsearch_data';

/** Blocks the thread outright; the readiness polls below are deliberately serial. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function printHeader() {
  console.log('');
  console.log('====================================');
  console.log('  Nadeshiko Backend Setup');
  console.log('====================================');
  console.log('');
}

function printSuccess(message: string) {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

function printWarning(message: string) {
  console.log(`\x1b[33m⚠\x1b[0m ${message}`);
}

function printInfo(message: string) {
  console.log(`  ${message}`);
}

function printSection(title: string) {
  console.log('');
  console.log(`\x1b[1m${title}\x1b[0m`);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function ensureEnvFile(): void {
  if (existsSync('.env')) {
    printSuccess('.env file already exists');
    return;
  }

  if (!existsSync('.env.example')) {
    throw new Error('.env.example not found. Are you running from the backend directory?');
  }

  copyFileSync('.env.example', '.env');
  printSuccess('Created .env from .env.example');
}

/** The Elasticsearch version `docker/Dockerfile.elasticsearch` currently pins. */
function pinnedElasticsearchVersion(): string | null {
  try {
    const from = readFileSync(ES_DOCKERFILE, 'utf-8');
    return from.match(/^FROM\s+\S+?:(\d+\.\d+\.\d+)(?:@|\s|$)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The Elasticsearch version baked into the image the local stack actually runs. */
function builtElasticsearchVersion(): string | null {
  try {
    const listed = execFileSync('docker', ['compose', 'images', '--format', 'json', 'elasticsearch'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const imageId = JSON.parse(listed)?.[0]?.ID;
    if (!imageId) return null;

    return (
      execFileSync(
        'docker',
        ['image', 'inspect', imageId, '--format', '{{index .Config.Labels "org.label-schema.version"}}'],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Docker never rebuilds a locally built image on its own, so a bumped pin in
 * the Dockerfile leaves the old image running indefinitely -- that is how the
 * stack sat on a stale 8.17 image for months. Both lookups return null on a
 * machine that has not built the image yet, which is not drift.
 */
function checkElasticsearchImageFreshness(): void {
  const pinned = pinnedElasticsearchVersion();
  const built = builtElasticsearchVersion();
  if (!pinned || !built || pinned === built) return;

  printWarning(`Elasticsearch image is ${built}, but ${ES_DOCKERFILE} pins ${pinned}`);
  printInfo('Rebuild it:');
  printInfo('  docker compose build elasticsearch && docker compose up -d elasticsearch');

  if (built.split('.')[0] !== pinned.split('.')[0]) {
    printInfo('');
    printInfo(`This crosses a major version: ${pinned} refuses to open a data directory`);
    printInfo(`written by ${built}, so the old volume has to go as well.`);
    printInfo('  docker compose down elasticsearch');
    printInfo(`  docker volume rm ${ES_DATA_VOLUME}`);
    printInfo('The local index is derived from Postgres -- `npm run es:reindex` rebuilds it.');
  }
  printInfo('');
}

function ensureDockerContainers(adminUser: string): void {
  printSection('Checking Docker containers...');

  if (!existsSync(DOCKER_COMPOSE_FILE)) {
    printWarning('docker-compose.yaml not found, skipping container check');
    return;
  }

  checkElasticsearchImageFreshness();

  try {
    const output = execFileSync('docker', ['compose', 'ps', '--format', 'json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.trim().split('\n').filter(Boolean);
    const running = lines.filter((line) => {
      try {
        const container = JSON.parse(line);
        return container.State === 'running';
      } catch {
        return false;
      }
    });

    if (running.length >= 2) {
      printSuccess('Docker containers are running');
      return;
    }
  } catch {
    // docker compose ps failed, containers likely not running
  }

  printWarning('Docker containers not running, starting them...');
  execFileSync('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });

  printInfo('Waiting for PostgreSQL to accept connections...');
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      execFileSync('docker', ['exec', 'nadeshiko-postgres', 'pg_isready', '-U', adminUser], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      printSuccess('PostgreSQL ready');
      break;
    } catch {
      sleepSync(1000);
    }
    if (i === maxAttempts - 1) throw new Error('PostgreSQL did not become ready in time');
  }

  printInfo('Waiting for Elasticsearch to accept connections...');
  const esMaxAttempts = 60;
  for (let i = 0; i < esMaxAttempts; i++) {
    try {
      // The node runs with xpack.security enabled, so an anonymous probe is
      // answered with 401. That still proves the HTTP layer is serving, which
      // is all this poll needs to know -- `curl -sf` would reject it and time
      // out against a perfectly healthy node.
      const status = execFileSync(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://127.0.0.1:9200/_cluster/health'],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      if (status === '200' || status === '401') {
        printSuccess('Elasticsearch ready');
        return;
      }
    } catch {
      // curl could not connect at all yet
    }
    sleepSync(2000);
  }

  reportElasticsearchStartupFailure();
  throw new Error('Elasticsearch did not become ready in time');
}

/**
 * A bare timeout says nothing about why. The two failures worth naming are an
 * old data directory a newer Elasticsearch refuses to open, and an image built
 * for the wrong CPU architecture -- both look identical from the outside.
 */
function reportElasticsearchStartupFailure(): void {
  let logs = '';
  try {
    logs = execFileSync('docker', ['logs', '--tail', '50', ES_CONTAINER], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return;
  }

  if (/created with version|cannot be read by version|IndexFormatTooOld|upgrade to version/i.test(logs)) {
    printWarning('Elasticsearch is refusing to open the existing data directory.');
    printInfo('It was written by an older major version. The local index is derived');
    printInfo('from Postgres, so the volume can be discarded and rebuilt:');
    printInfo('  docker compose down elasticsearch');
    printInfo(`  docker volume rm ${ES_DATA_VOLUME}`);
    printInfo('  docker compose up -d elasticsearch');
    return;
  }

  if (/does not support all of the following CPU features|Please rebuild the executable/i.test(logs)) {
    printWarning("The Elasticsearch image does not match this machine's CPU architecture.");
    printInfo('Rebuild it locally so it picks the host platform:');
    printInfo('  docker compose build elasticsearch');
    return;
  }

  printWarning(`Elasticsearch never became ready. Last log lines from ${ES_CONTAINER}:`);
  for (const line of logs.trim().split('\n').slice(-10)) printInfo(line);
}

function runDbSetup(): void {
  printSection('Initializing infrastructure...');
  printInfo('- PostgreSQL bootstrap + database recreation');
  printInfo('- Migrations + seed data');
  printInfo('- pg-boss schema setup');
  printInfo('- Elasticsearch role/user + index reset');
  console.log('');

  execFileSync('npm', ['run', 'db:setup'], { stdio: 'inherit' });
  printSuccess('Infrastructure ready');
}

/**
 * The test suite authenticates to Elasticsearch as the `.env.test` user, which
 * nothing else creates: `npm run test:setup` loads `.env.test`, and that file
 * carries no admin password, so its role/user step silently no-ops. On a fresh
 * cluster the whole Elasticsearch integration suite then skips itself.
 * Provision it here, where `.env` supplies admin credentials.
 */
function setupElasticsearchTestUser(): void {
  printSection('Provisioning Elasticsearch test user...');

  if (!process.env.ELASTICSEARCH_ADMIN_PASSWORD) {
    printWarning('ELASTICSEARCH_ADMIN_PASSWORD is not set in .env; skipping test user provisioning');
    printInfo('Elasticsearch-backed tests will skip themselves until it is provisioned.');
    return;
  }

  // Shell env beats --env-file, so the dev-stack values loaded from .env have to
  // be dropped for .env.test's test-user/index values to take effect.
  const childEnv = { ...process.env };
  for (const key of ['ELASTICSEARCH_USER', 'ELASTICSEARCH_PASSWORD', 'ELASTICSEARCH_INDEX', 'POSTGRES_DB']) {
    delete childEnv[key];
  }
  // ...and for the same reason LOG_LEVEL has to be forced, or `.env.test`'s
  // `silent` would make this step produce no output at all, success or failure.
  childEnv.LOG_LEVEL = 'info';

  try {
    execFileSync('node', ['--env-file=.env.test', '--import', 'tsx', 'bin/es.ts', 'setup-role'], {
      stdio: 'inherit',
      env: childEnv,
    });
    printSuccess('Elasticsearch test user ready');
  } catch {
    printWarning('Could not provision the Elasticsearch test user');
    printInfo('Elasticsearch-backed tests will skip themselves until it is provisioned.');
  }
}

async function downloadSeedDump(token: string): Promise<boolean> {
  printSection('Downloading seed database...');

  const url = `${SEED_URL}?token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(url);

    if (response.status === 401) {
      printWarning('Invalid seed token');
      return false;
    }

    if (!response.ok) {
      printWarning(`Seed download failed: ${response.status} ${response.statusText}`);
      return false;
    }

    const contentLength = response.headers.get('Content-Length');
    const sizeInfo = contentLength ? ` (${(Number(contentLength) / 1024 / 1024).toFixed(1)} MB)` : '';
    printInfo(`Downloading${sizeInfo}...`);

    const arrayBuffer = await response.arrayBuffer();
    await writeFile(SEED_DUMP_PATH, Buffer.from(arrayBuffer));
    printSuccess('Seed database downloaded');
    return true;
  } catch (error) {
    printWarning(`Could not connect to seed server: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const SEED_CONTENT_TABLES = ['Media', 'Episode', 'Segment', 'MediaExternalId'];

function restoreSeedDump(adminUser: string, appDatabase: string): void {
  printInfo('Copying dump into PostgreSQL container...');

  execFileSync('docker', ['cp', SEED_DUMP_PATH, 'nadeshiko-postgres:/tmp/seed.dump'], {
    stdio: 'pipe',
  });

  // List what's in the dump so we can verify table names match
  try {
    const listing = execFileSync('docker', ['exec', 'nadeshiko-postgres', 'pg_restore', '-l', '/tmp/seed.dump'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const tables = listing.split('\n').filter((l) => l.includes(' TABLE DATA '));
    for (const line of tables) printInfo(`  ${line.trim()}`);
  } catch {}

  printInfo('Restoring content tables...');
  const tableArgs = SEED_CONTENT_TABLES.flatMap((t) => ['-t', t]);
  try {
    const result = execFileSync(
      'docker',
      [
        'exec',
        'nadeshiko-postgres',
        'pg_restore',
        '-U',
        adminUser,
        '-d',
        appDatabase,
        '--no-owner',
        '--no-privileges',
        '--data-only',
        '--disable-triggers',
        ...tableArgs,
        '/tmp/seed.dump',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (result) printInfo(result.trim());
  } catch (error: any) {
    const stdout = error.stdout?.toString().trim();
    const stderr = error.stderr?.toString().trim();
    if (stdout) printInfo(stdout.split('\n').slice(0, 10).join('\n'));
    if (stderr) printWarning(stderr.split('\n').slice(0, 10).join('\n'));
  }

  // Verify data was restored
  const countQuery = SEED_CONTENT_TABLES.map((t) => `SELECT '${t}' AS t, COUNT(*) AS c FROM "${t}"`).join(
    ' UNION ALL ',
  );
  try {
    const counts = execFileSync(
      'docker',
      ['exec', 'nadeshiko-postgres', 'psql', '-U', adminUser, '-d', appDatabase, '-t', '-c', countQuery],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    for (const line of counts.trim().split('\n').filter(Boolean)) {
      const [table, count] = line.split('|').map((s) => s.trim());
      if (count && count !== '0') printInfo(`  ${table}: ${count} rows`);
    }
  } catch {}

  printInfo('Cleaning up dump files...');
  execFileSync('docker', ['exec', 'nadeshiko-postgres', 'rm', '-f', '/tmp/seed.dump'], {
    stdio: 'pipe',
  });
  try {
    unlinkSync(SEED_DUMP_PATH);
  } catch {}

  printSuccess('Seed database restored');
}

function rerunSeeds(): void {
  printInfo('Re-running seeds to match local credentials...');
  execFileSync('npm', ['run', 'db:seed'], { stdio: 'inherit' });
  printSuccess('Seeds applied');
}

function reindexElasticsearch(): void {
  printInfo('Indexing segments into Elasticsearch...');
  execFileSync('npm', ['run', 'es:reindex'], { stdio: 'inherit' });
  printSuccess('Elasticsearch reindex complete');
}

async function handleSeedDownload(adminUser: string, appDatabase: string): Promise<void> {
  printSection('Seed database');
  printInfo('The seed contains sample media files and content for developing and debugging');
  printInfo('content-related features. Ask a project admin in the Nadeshiko Discord for a token.');
  console.log('');

  const answer = await prompt('Download seed database? Requires a token from a project admin. (y/N) ');
  if (answer.toLowerCase() !== 'y') {
    printInfo('Skipping seed download. The database has base seed data (admin user + API key).');
    return;
  }

  while (true) {
    const inputToken = await prompt('Enter seed token: ');
    if (!inputToken) {
      printWarning('No token provided, skipping seed download');
      return;
    }

    const downloaded = await downloadSeedDump(inputToken);
    if (downloaded) {
      restoreSeedDump(adminUser, appDatabase);
      rerunSeeds();
      reindexElasticsearch();
      return;
    }

    const retry = await prompt('Try again? (Y/n) ');
    if (retry.toLowerCase() === 'n') {
      printInfo('Skipping seed download.');
      return;
    }
  }
}

async function main() {
  try {
    printHeader();
    ensureEnvFile();

    // Import config after .env is ensured
    const { config } = await import('@config/config');

    const adminUser = config.POSTGRES_ADMIN_USER || config.POSTGRES_USER;

    const appDatabase = config.POSTGRES_DB;

    ensureDockerContainers(adminUser);
    runDbSetup();
    setupElasticsearchTestUser();
    await handleSeedDownload(adminUser, appDatabase);

    console.log('');
    console.log('====================================');
    console.log('  Setup Complete!');
    console.log('====================================');
    console.log('');
    printSuccess('PostgreSQL and Elasticsearch are running');
    printSuccess('Database migrated and seeded');
    printSuccess('pg-boss job queue initialized');
    console.log('');
    console.log('Admin credentials:');
    console.log(`  Email:    ${config.EMAIL_API_NADEDB}`);
    console.log(`  API Key:  ${config.API_KEY_MASTER}`);
    console.log('');
    console.log('To start developing, run these in separate terminals:');
    console.log('');
    console.log(`  cd backend  && npm run dev     # API on http://localhost:${config.PORT}`);
    console.log('  cd frontend && npm run dev     # App on http://localhost:3000');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\nSetup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
