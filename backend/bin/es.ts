import '@config/boot';
import { client, resetElasticsearchIndex } from '@config/elasticsearch';
import { logger } from '@config/log';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { Segment } from '@app/models';
import { AppDataSource } from '@config/database';
import { ensureDestructiveAllowed } from './destructiveGuard';
import { INDEX_NAME } from '@config/elasticsearch';

const commandArgs = process.argv.slice(3);

async function reindex(): Promise<void> {
  logger.info(`Reindexing Elasticsearch index '${INDEX_NAME}'...`);

  await resetElasticsearchIndex();

  const result = await SegmentDocument.reindex();
  if (!result.success) {
    throw new Error(result.message);
  }

  logger.info(
    `Reindex complete: ${result.stats!.successfulIndexes}/${result.stats!.totalSegments} segments indexed (${result.stats!.failedIndexes} failed)`,
  );
}

async function status(): Promise<void> {
  logger.info(`Checking Elasticsearch index '${INDEX_NAME}'...`);

  const dbSegmentCount = await Segment.count();

  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (!exists) {
    logger.warn(`Index '${INDEX_NAME}' does not exist`);
    logger.info(`DB segments: ${dbSegmentCount}`);
    logger.info(`ES documents: 0`);
    logger.warn(`Out of sync: DB has ${dbSegmentCount} more segment(s) than Elasticsearch`);
    return;
  }

  const countResponse = await client.count({ index: INDEX_NAME });
  const esDocumentCount = countResponse.count ?? 0;
  const delta = esDocumentCount - dbSegmentCount;

  logger.info(`DB segments: ${dbSegmentCount}`);
  logger.info(`ES documents: ${esDocumentCount}`);

  if (delta === 0) {
    logger.info('Elasticsearch index is in sync with database segment count');
    return;
  }

  if (delta > 0) {
    logger.warn(`Out of sync: Elasticsearch has ${delta} more document(s) than DB segments`);
    return;
  }

  logger.warn(`Out of sync: DB has ${Math.abs(delta)} more segment(s) than Elasticsearch`);
}

function printUsage(): void {
  console.log(`
Usage: bun run bin/es.ts <command>

Commands:
  reindex  Reset and repopulate Elasticsearch index from database (destructive)
  status  Compare DB segment count vs Elasticsearch document count

For destructive commands in prod, add: --allow-prod-destructive
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  if (command !== 'reindex' && command !== 'status') {
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
