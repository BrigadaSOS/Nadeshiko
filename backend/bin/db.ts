import 'dotenv/config';
import { execSync } from 'child_process';
import { AppDataSource } from '@config/database';
import { seed } from '@db/seeds';
import { logger } from '@lib/utils/log';

const command = process.argv[2];

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
  await migrate();
  await runSeed();
  await setupPgBoss();
  await setupElasticsearchUserAndRole();
  logger.info('Setup complete');
}

async function setupPgBoss(): Promise<void> {
  logger.info('Setting up pg-boss job queue schema...');
  try {
    // pg-boss CLI handles schema creation idempotently
    execSync('npx pg-boss create --schema pgboss', {
      stdio: 'pipe',
      env: {
        ...process.env,
        PGBOSS_HOST: process.env.POSTGRES_HOST,
        PGBOSS_PORT: process.env.POSTGRES_PORT,
        PGBOSS_DATABASE: process.env.POSTGRES_DB,
        PGBOSS_USER: process.env.POSTGRES_USER,
        PGBOSS_PASSWORD: process.env.POSTGRES_PASSWORD,
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

async function setupElasticsearch(): Promise<void> {
  logger.info('Setting up Elasticsearch index...');
  try {
    const { initializeElasticsearchIndex } = await import('@lib/external/elasticsearch');
    await initializeElasticsearchIndex();
    logger.info('Elasticsearch index ready');
  } catch (error) {
    logger.error(error, 'Elasticsearch index setup failed');
    throw error; // Re-throw since ES is required for the app to function
  }
}

async function setupElasticsearchUserAndRole(): Promise<void> {
  logger.info('Setting up Elasticsearch user and role...');
  try {
    const { setupElasticsearchUser, initializeElasticsearchIndexWithClient } = await import('@lib/external/elasticsearch');
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
    const username = await setupElasticsearchUser();

    // Use admin client to create the index (since app user may not exist yet)
    logger.info('Using admin client to create index');
    await initializeElasticsearchIndexWithClient(adminClient);
  } catch (error) {
    logger.error(error, 'Elasticsearch user setup failed');
    throw error;
  }
}

async function reset(): Promise<void> {
  await drop();
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
  await runSeed();
  logger.info('Prepare complete');
}

function printUsage(): void {
  console.log(`
Usage: bun run bin/db.ts <command>

Commands:
  migrate   Run pending migrations
  rollback  Revert the last migration
  seed      Load seed data (roles, permissions, admin user, media)
  setup     Run migrations + seed (first-time setup)
  reset     Drop all tables + setup (destructive!)
  prepare   Idempotent setup: migrate if needed + seed (CI/CD friendly)
  drop      Drop all tables (destructive!)
  status    Show if there are pending migrations
`);
}

async function main(): Promise<void> {
  if (!command) {
    printUsage();
    process.exit(1);
  }

  await AppDataSource.initialize();

  try {
    switch (command) {
      case 'migrate':
        await migrate();
        break;
      case 'rollback':
        await rollback();
        break;
      case 'seed':
        await runSeed();
        break;
      case 'setup':
        await setup();
        break;
      case 'reset':
        await reset();
        break;
      case 'prepare':
        await prepare();
        break;
      case 'drop':
        await drop();
        break;
      case 'status':
        await status();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
