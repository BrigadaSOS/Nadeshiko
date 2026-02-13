import 'dotenv/config';
import { execSync } from 'child_process';
import { AppDataSource } from '@config/database';
import { seed } from '@db/seeds';
import { bootstrapPostgresWithOptions } from './dbBootstrap';
import { ensureDestructiveAllowed } from './destructiveGuard';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { logger } from '@config/log';

const command = process.argv[2];
const commandArgs = process.argv.slice(3);

async function migrate(): Promise<void> {
  logger.info('Running pending migrations...');
  await AppDataSource.runMigrations();
  logger.info('Migrations completed');
}

async function rollback(): Promise<void> {
  logger.info('Reverting last migration...');
  await AppDataSource.undoLastMigration();
  logger.info('Last migration reverted');
}

async function runSeed(): Promise<void> {
  logger.info('Loading seed data...');
  await seed();
  logger.info('Seed data loaded successfully');
}

async function drop(): Promise<void> {
  logger.info('Dropping all tables...');

  await AppDataSource.dropDatabase();
  logger.info('All tables dropped');
}

async function status(): Promise<void> {
  logger.info('Checking migration status...');
  const hasPending = await AppDataSource.showMigrations();
  if (hasPending) {
    logger.info('There are pending migrations');
  } else {
    logger.info('All migrations are up to date');
  }
}

async function setup(): Promise<void> {
  logger.info('Running destructive setup: recreating database + Elasticsearch index...');

  await drop();
  await migrate();
  await runSeed();
  await setupPgBoss();
  await setupElasticsearchUserAndRole({ recreateIfExists: true });
  await resetElasticsearchIndex();
  logger.info('Setup complete');
}

async function setupPgBoss(): Promise<void> {
  logger.info('Setting up pg-boss job queue schema...');
  try {
    const postgres = getAppPostgresConfig();

    // pg-boss CLI handles schema creation idempotently
    execSync('npx pg-boss create --schema pgboss', {
      stdio: 'pipe',
      env: {
        ...process.env,
        PGBOSS_HOST: postgres.host,
        PGBOSS_PORT: String(postgres.port),
        PGBOSS_DATABASE: postgres.database,
        PGBOSS_USER: postgres.user,
        PGBOSS_PASSWORD: postgres.password,
      },
    });
    logger.info('pg-boss schema ready');
  } catch (error) {
    // Check if it's already exists (safe to ignore)
    if (error instanceof Error && error.message.includes('already exists')) {
      logger.info('pg-boss schema already exists');
    } else {
      logger.warn('pg-boss schema setup failed (will retry on app start)');
    }
  }
}

async function resetElasticsearchIndex(): Promise<void> {
  logger.info('Resetting Elasticsearch index...');
  const { resetElasticsearchIndex } = await import('@app/services/elasticsearch');
  await resetElasticsearchIndex();
}

async function setupElasticsearchUserAndRole(options: { recreateIfExists?: boolean } = {}): Promise<void> {
  logger.info('Setting up Elasticsearch user and role...');
  try {
    const { setupElasticsearchUser, initializeElasticsearchIndexWithClient } = await import('@app/services/elasticsearch');
    const { Client } = await import('@elastic/elasticsearch');

    // Create admin client
    const adminUser = process.env.ELASTICSEARCH_ADMIN_USER || 'elastic';
    const adminPassword = process.env.ELASTICSEARCH_ADMIN_PASSWORD;

    if (!adminPassword) {
      logger.info('ELASTICSEARCH_ADMIN_PASSWORD not set, skipping user/role creation');
      return;
    }

    const { HttpConnection } = await import('@elastic/elasticsearch');
    const adminClient = new Client({
      node: process.env.ELASTICSEARCH_HOST,
      auth: {
        username: adminUser,
        password: adminPassword,
      },
      Connection: HttpConnection,
    });

    // Create user and role first
    await setupElasticsearchUser({ recreateIfExists: options.recreateIfExists });

    // Use admin client to create the index (since app user may not exist yet)
    logger.info('Using admin client to create index');
    await initializeElasticsearchIndexWithClient(adminClient);
  } catch (error) {
    logger.error(error, 'Elasticsearch user setup failed');
    throw error;
  }
}

async function reset(): Promise<void> {
  await setup();
  logger.info('Reset complete');
}

async function prepare(): Promise<void> {
  // Idempotent: only runs what's needed
  const hasPending = await AppDataSource.showMigrations();
  if (hasPending) {
    await migrate();
  } else {
    logger.info('No pending migrations');
  }
  await setupPgBoss();
  await setupElasticsearchUserAndRole();
  logger.info('Prepare complete');
}

function printUsage(): void {
  console.log(`
Usage: bun run bin/db.ts <command>

Commands:
  migrate   Run pending migrations
  rollback  Revert the last migration (destructive)
  seed      Load seed data (roles, permissions, admin user, media)
  setup     Recreate app role/database + ES role/user/index + migrate + seed (destructive)
  reset     Alias for setup (destructive)
  prepare   Non-destructive deploy task: migrate if needed + infrastructure checks
  drop      Drop all tables (destructive!)
  status    Show if there are pending migrations

For destructive commands in prod, add: --allow-prod-destructive
`);
}

async function main(): Promise<void> {
  if (!command) {
    printUsage();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'migrate':
        await AppDataSource.initialize();
        await migrate();
        break;
      case 'rollback':
        ensureDestructiveAllowed('db:rollback', commandArgs);
        await AppDataSource.initialize();
        await rollback();
        break;
      case 'seed':
        await AppDataSource.initialize();
        await runSeed();
        break;
      case 'setup':
        ensureDestructiveAllowed('db:setup', commandArgs);
        await bootstrapPostgresWithOptions({ recreateRoleAndDatabase: true });
        await AppDataSource.initialize();
        await setup();
        break;
      case 'reset':
        ensureDestructiveAllowed('db:reset', commandArgs);
        await bootstrapPostgresWithOptions({ recreateRoleAndDatabase: true });
        await AppDataSource.initialize();
        await reset();
        break;
      case 'prepare':
        await bootstrapPostgresWithOptions();
        await AppDataSource.initialize();
        await prepare();
        break;
      case 'drop':
        ensureDestructiveAllowed('db:drop', commandArgs);
        await AppDataSource.initialize();
        await drop();
        break;
      case 'status':
        await AppDataSource.initialize();
        await status();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
