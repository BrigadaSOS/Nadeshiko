import 'dotenv/config';
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
  logger.info('Setup complete');
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
