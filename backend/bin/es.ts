import '@config/boot';
import {
  client,
  INDEX_NAME,
  reindexZeroDowntime,
  resolvePhysicalIndex,
  listVersionedIndices,
  rollbackAlias,
  cleanupOldIndices,
  migrateToAlias,
} from '@config/elasticsearch';
import { logger } from '@config/log';
import { Segment } from '@app/models';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { AppDataSource } from '@config/database';
import { ensureDestructiveAllowed } from './destructiveGuard';

const commandArgs = process.argv.slice(3);

async function reindex(): Promise<void> {
  logger.info(`Starting zero-downtime reindex for alias '${INDEX_NAME}'...`);

  const result = await reindexZeroDowntime((targetIndex) => SegmentDocument.reindex(undefined, targetIndex));

  if (!result.success) {
    throw new Error(result.message);
  }

  logger.info(
    `Reindex complete: ${result.stats!.successfulIndexes}/${result.stats!.totalSegments} segments indexed (${result.stats!.failedIndexes} failed)`,
  );

  const physical = await resolvePhysicalIndex();
  logger.info(`Alias '${INDEX_NAME}' now points to '${physical}'`);
}

async function status(): Promise<void> {
  logger.info(`Checking Elasticsearch alias '${INDEX_NAME}'...`);

  const dbSegmentCount = await Segment.count();
  const physical = await resolvePhysicalIndex();

  if (!physical) {
    const concreteExists = await client.indices.exists({ index: INDEX_NAME });
    if (concreteExists) {
      logger.warn(`'${INDEX_NAME}' exists as a concrete index (legacy). Run 'migrate' to convert to alias-based setup.`);
      const countResponse = await client.count({ index: INDEX_NAME });
      logger.info(`DB segments: ${dbSegmentCount}`);
      logger.info(`ES documents: ${countResponse.count}`);
    } else {
      logger.warn(`Neither alias nor index '${INDEX_NAME}' exists`);
      logger.info(`DB segments: ${dbSegmentCount}`);
      logger.info(`ES documents: 0`);
    }
    return;
  }

  logger.info(`Alias '${INDEX_NAME}' -> ${physical}`);

  const allVersioned = await listVersionedIndices();
  const otherIndices = allVersioned.filter((idx) => idx !== physical);
  if (otherIndices.length > 0) {
    logger.info(`Previous indices (available for rollback): ${otherIndices.join(', ')}`);
  } else {
    logger.info('No previous indices available for rollback');
  }

  const countResponse = await client.count({ index: INDEX_NAME });
  const esDocumentCount = countResponse.count ?? 0;
  const delta = esDocumentCount - dbSegmentCount;

  logger.info(`DB segments: ${dbSegmentCount}`);
  logger.info(`ES documents: ${esDocumentCount}`);

  if (delta === 0) {
    logger.info('Elasticsearch index is in sync with database segment count');
  } else if (delta > 0) {
    logger.warn(`Out of sync: Elasticsearch has ${delta} more document(s) than DB segments`);
  } else {
    logger.warn(`Out of sync: DB has ${Math.abs(delta)} more segment(s) than Elasticsearch`);
  }
}

async function rollback(): Promise<void> {
  logger.info(`Rolling back alias '${INDEX_NAME}'...`);

  const { from, to } = await rollbackAlias();
  logger.info(`Rolled back: '${INDEX_NAME}' now points to '${to}' (was '${from}')`);
}

async function cleanup(): Promise<void> {
  const physical = await resolvePhysicalIndex();
  logger.info(`Cleaning up old indices for alias '${INDEX_NAME}' (current: ${physical})...`);

  const deleted = await cleanupOldIndices();

  if (deleted.length === 0) {
    logger.info('No old indices to clean up');
  } else {
    logger.info(`Deleted ${deleted.length} old index(es): ${deleted.join(', ')}`);
  }
}

async function migrate(): Promise<void> {
  logger.info(`Migrating '${INDEX_NAME}' from concrete index to alias-based setup...`);
  await migrateToAlias();
}

async function setupRole(): Promise<void> {
  const { setupElasticsearchUser } = await import('@config/elasticsearch');
  const username = await setupElasticsearchUser();
  logger.info(`Elasticsearch role updated for user '${username}'`);
}

function printUsage(): void {
  console.log(`
Usage: bun run bin/es.ts <command>

Commands:
  reindex      Zero-downtime reindex: creates new versioned index, populates from DB, swaps alias
  status       Show alias info, versioned indices, and DB vs ES document count
  rollback     Swap alias back to the previous versioned index (instant)
  cleanup      Delete old versioned indices no longer pointed to by the alias
  migrate      One-time migration from concrete index to alias-based setup
  setup-role   Update the ES user role to include versioned index access

For destructive commands in prod, add: --allow-prod-destructive
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  const validCommands = ['reindex', 'status', 'rollback', 'cleanup', 'migrate', 'setup-role'];
  if (!validCommands.includes(command)) {
    logger.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  try {
    await AppDataSource.initialize();

    switch (command) {
      case 'reindex':
        ensureDestructiveAllowed('es:reindex', commandArgs);
        await reindex();
        break;
      case 'status':
        await status();
        break;
      case 'rollback':
        ensureDestructiveAllowed('es:rollback', commandArgs);
        await rollback();
        break;
      case 'cleanup':
        ensureDestructiveAllowed('es:cleanup', commandArgs);
        await cleanup();
        break;
      case 'migrate':
        ensureDestructiveAllowed('es:migrate', commandArgs);
        await migrate();
        break;
      case 'setup-role':
        await setupRole();
        break;
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main();
