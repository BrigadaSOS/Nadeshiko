import 'dotenv/config';
import { client } from '@lib/external/elasticsearch';
import { logger } from '@lib/utils/log';
import elasticsearchSchema from 'config/elasticsearch-schema.json';

const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || elasticsearchSchema.index;

async function reset(): Promise<void> {
  logger.info(`Resetting Elasticsearch index '${INDEX_NAME}'...`);

  // Check if index exists
  const indexExists = await client.indices.exists({ index: INDEX_NAME });

  if (indexExists) {
    logger.info(`Deleting existing index '${INDEX_NAME}'...`);
    await client.indices.delete({ index: INDEX_NAME });
    logger.info(`Index '${INDEX_NAME}' deleted`);
  }

  // Create new index with schema
  logger.info(`Creating new index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);
  await client.indices.create({
    index: INDEX_NAME,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' created successfully`);
  logger.info('Run the reindex API endpoint to populate the index with data');
}

async function status(): Promise<void> {
  logger.info(`Checking Elasticsearch index '${INDEX_NAME}'...`);

  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (!exists) {
    logger.info(`Index '${INDEX_NAME}' does not exist`);
    return;
  }

  const stats = await client.indices.stats({ index: INDEX_NAME });
  // @ts-expect-error -- elasticsearch stats type
  const docCount = stats.indices[INDEX_NAME]?.total?.docs?.count ?? 0;
  logger.info(`Index '${INDEX_NAME}' exists with ${docCount} documents`);
}

function printUsage(): void {
  console.log(`
Usage: bun run bin/es.ts <command>

Commands:
  reset   Delete and recreate the Elasticsearch index (destructive!)
  status  Show index status and document count

Note: After running 'reset', use the /v1/admin/reindex API endpoint to populate data
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'reset':
        await reset();
        break;
      case 'status':
        await status();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
}

main();
