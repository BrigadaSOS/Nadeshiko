import { Client, HttpConnection } from '@elastic/elasticsearch';
import { config, type AppConfig } from '@config/config';
import { logger } from '@config/log';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type { t_ReindexResponse } from 'generated/models';

export const INDEX_NAME = config.ELASTICSEARCH_INDEX;

export const client = new Client({
  node: config.ELASTICSEARCH_HOST,
  auth: {
    username: config.ELASTICSEARCH_USER,
    password: config.ELASTICSEARCH_PASSWORD,
  },
  Connection: HttpConnection,
  maxSockets: 10,
  keepAliveTimeout: 60000,
});

/**
 * Creates an admin client using ELASTICSEARCH_ADMIN_* credentials.
 * Only used for setup operations (creating users/roles).
 */
function createAdminClient(configValues: AppConfig): Client {
  const adminUser = configValues.ELASTICSEARCH_ADMIN_USER || 'elastic';
  const adminPassword = configValues.ELASTICSEARCH_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error('ELASTICSEARCH_ADMIN_PASSWORD is required for admin operations');
  }

  return new Client({
    node: configValues.ELASTICSEARCH_HOST,
    auth: {
      username: adminUser,
      password: adminPassword,
    },
    Connection: HttpConnection,
    maxSockets: 10,
    keepAliveTimeout: 60000,
  });
}

/**
 * Sets up the Elasticsearch application user and role.
 * Creates an index-scoped user that can only access the configured index
 * and any versioned indices (INDEX_NAME_v*).
 *
 * This function uses ADMIN credentials and is idempotent - safe to run multiple times.
 * By default, it will skip creation if the user already exists.
 *
 * @returns The username that was created (or already existed)
 */
export async function setupElasticsearchUser(
  options: { recreateIfExists?: boolean; configValues?: AppConfig } = {},
): Promise<string> {
  const { recreateIfExists = false, configValues = config } = options;
  const indexName = configValues.ELASTICSEARCH_INDEX;
  const appUsername = configValues.ELASTICSEARCH_USER;
  const appPassword = configValues.ELASTICSEARCH_PASSWORD;

  if (!configValues.ELASTICSEARCH_ADMIN_PASSWORD) {
    logger.info('ELASTICSEARCH_ADMIN_PASSWORD not set, skipping user/role setup');
    return appUsername || 'elastic';
  }

  if (!appPassword) {
    throw new Error('ELASTICSEARCH_PASSWORD is required to create the application user');
  }

  const username = appUsername || `${indexName.replace(/[^a-zA-Z0-9]/g, '_')}_user`;
  const roleName = `${username}_role`;

  const adminClient = createAdminClient(configValues);

  try {
    if (recreateIfExists) {
      logger.info({ username, roleName }, 'Recreating Elasticsearch app user and role');

      await adminClient.security.deleteUser({ username }).catch((error) => {
        if (error.meta.statusCode !== 404) throw error;
      });

      await adminClient.security.deleteRole({ name: roleName }).catch((error) => {
        if (error.meta.statusCode !== 404) throw error;
      });
    }

    const userExists = await adminClient.security
      .getUser({ username })
      .then(() => true)
      .catch((error) => {
        if (error.meta.statusCode === 404) return false;
        throw error;
      });

    logger.info({ roleName, indexName }, 'Upserting Elasticsearch role');
    await adminClient.security.putRole({
      name: roleName,
      cluster: ['monitor'],
      indices: [{ names: [indexName, `${indexName}_v*`], privileges: ['all'], allow_restricted_indices: false }],
    });

    if (userExists && !recreateIfExists) {
      logger.info({ username, roleName }, 'Elasticsearch user already exists; role updated, skipping user update');
      return username;
    }

    logger.info({ username, roleName }, 'Creating Elasticsearch user');
    await adminClient.security.putUser({
      username,
      password: appPassword,
      roles: [roleName],
      full_name: `Nadeshiko App User for ${indexName}`,
    });

    logger.info({ username, roleName, indexName }, 'Elasticsearch user and role created successfully');
    return username;
  } catch (error) {
    logger.error(error, 'Failed to setup Elasticsearch user/role');
    throw error;
  }
}

export async function resolvePhysicalIndex(esClient?: Client): Promise<string | null> {
  const clientToUse = esClient || client;
  try {
    const aliasResponse = await clientToUse.indices.getAlias({ name: INDEX_NAME });
    const indices = Object.keys(aliasResponse);
    return indices.length > 0 ? indices[0] : null;
  } catch (error: any) {
    if (error.meta?.statusCode === 404) return null;
    throw error;
  }
}

export function nextVersionName(current: string | null): string {
  if (!current) return `${INDEX_NAME}_v1`;

  const match = current.match(/_v(\d+)$/);
  if (!match) return `${INDEX_NAME}_v1`;

  const nextVersion = parseInt(match[1], 10) + 1;
  return `${INDEX_NAME}_v${nextVersion}`;
}

export async function listVersionedIndices(esClient?: Client): Promise<string[]> {
  const clientToUse = esClient || client;
  try {
    const response = await clientToUse.indices.get({ index: `${INDEX_NAME}_v*` });
    return Object.keys(response).sort();
  } catch (error: any) {
    if (error.meta?.statusCode === 404) return [];
    throw error;
  }
}

export async function initializeElasticsearchIndex(): Promise<void> {
  await initializeElasticsearchIndexWithClient(client);
}

export async function initializeElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;

  const aliasExists = await clientToUse.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    const physical = await resolvePhysicalIndex(clientToUse);
    logger.info(`Elasticsearch alias '${INDEX_NAME}' exists, pointing to '${physical}'`);
    return;
  }

  const concreteExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (concreteExists) {
    logger.warn(
      `Elasticsearch index '${INDEX_NAME}' exists as a concrete index (legacy). Run 'bun run bin/es.ts migrate' to convert to alias-based setup.`,
    );
    return;
  }

  const physicalName = `${INDEX_NAME}_v1`;
  logger.info(`Creating Elasticsearch index '${physicalName}' with alias '${INDEX_NAME}'`);

  await clientToUse.indices.create({
    index: physicalName,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  await clientToUse.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info(`Elasticsearch index '${physicalName}' created with alias '${INDEX_NAME}'`);
}

export async function resetElasticsearchIndex(): Promise<void> {
  await resetElasticsearchIndexWithClient(client);
}

export async function resetElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;

  const aliasExists = await clientToUse.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    const allVersioned = await listVersionedIndices(clientToUse);
    for (const idx of allVersioned) {
      await clientToUse.indices.delete({ index: idx });
    }
    logger.info(`Deleted alias '${INDEX_NAME}' and ${allVersioned.length} versioned index(es)`);
  } else {
    const concreteExists = await clientToUse.indices.exists({ index: INDEX_NAME });
    if (concreteExists) {
      await clientToUse.indices.delete({ index: INDEX_NAME });
    }
  }

  const physicalName = `${INDEX_NAME}_v1`;
  await clientToUse.indices.create({
    index: physicalName,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  await clientToUse.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info(`Elasticsearch index '${physicalName}' recreated with alias '${INDEX_NAME}'`);
}

export async function reindexZeroDowntime(
  populateFn: (targetIndex: string) => Promise<t_ReindexResponse>,
  esClient?: Client,
): Promise<t_ReindexResponse> {
  const clientToUse = esClient || client;

  const currentPhysical = await resolvePhysicalIndex(clientToUse);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist. Run initialization first.`);
  }

  const newPhysical = nextVersionName(currentPhysical);
  logger.info({ currentPhysical, newPhysical }, 'Starting zero-downtime reindex');

  await clientToUse.indices.create({
    index: newPhysical,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  try {
    const result = await populateFn(newPhysical);

    if (!result.success) {
      throw new Error(`Reindex population failed: ${result.message}`);
    }

    await clientToUse.indices.refresh({ index: newPhysical });

    await clientToUse.indices.updateAliases({
      actions: [
        { remove: { index: currentPhysical, alias: INDEX_NAME } },
        { add: { index: newPhysical, alias: INDEX_NAME, is_write_index: true } },
      ],
    });

    logger.info({ currentPhysical, newPhysical }, 'Alias swapped successfully. Old index kept for rollback.');

    return result;
  } catch (error) {
    logger.error({ newPhysical, error }, 'Zero-downtime reindex failed, cleaning up new index');
    await clientToUse.indices.delete({ index: newPhysical }).catch((deleteError) => {
      logger.warn({ newPhysical, deleteError }, 'Failed to clean up new index after reindex failure');
    });
    throw error;
  }
}

export async function rollbackAlias(esClient?: Client): Promise<{ from: string; to: string }> {
  const clientToUse = esClient || client;

  const currentPhysical = await resolvePhysicalIndex(clientToUse);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist.`);
  }

  const allVersioned = await listVersionedIndices(clientToUse);
  const currentVersion = extractVersion(currentPhysical);

  const previousIndices = allVersioned
    .filter((idx) => idx !== currentPhysical)
    .filter((idx) => extractVersion(idx) < currentVersion)
    .sort((a, b) => extractVersion(b) - extractVersion(a));

  if (previousIndices.length === 0) {
    throw new Error('No previous index available for rollback.');
  }

  const rollbackTarget = previousIndices[0];

  await clientToUse.indices.updateAliases({
    actions: [
      { remove: { index: currentPhysical, alias: INDEX_NAME } },
      { add: { index: rollbackTarget, alias: INDEX_NAME, is_write_index: true } },
    ],
  });

  logger.info({ from: currentPhysical, to: rollbackTarget }, 'Alias rolled back successfully');

  return { from: currentPhysical, to: rollbackTarget };
}

export async function cleanupOldIndices(esClient?: Client): Promise<string[]> {
  const clientToUse = esClient || client;

  const currentPhysical = await resolvePhysicalIndex(clientToUse);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist.`);
  }

  const allVersioned = await listVersionedIndices(clientToUse);
  const toDelete = allVersioned.filter((idx) => idx !== currentPhysical);

  for (const idx of toDelete) {
    await clientToUse.indices.delete({ index: idx });
    logger.info({ index: idx }, 'Deleted old versioned index');
  }

  return toDelete;
}

export async function migrateToAlias(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;

  const aliasExists = await clientToUse.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    logger.info(`'${INDEX_NAME}' is already an alias. No migration needed.`);
    return;
  }

  const concreteExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (!concreteExists) {
    throw new Error(`Neither alias nor concrete index '${INDEX_NAME}' exists. Run initialization first.`);
  }

  const physicalName = `${INDEX_NAME}_v1`;
  logger.info({ source: INDEX_NAME, target: physicalName }, 'Migrating concrete index to alias-based setup');

  await clientToUse.indices.create({
    index: physicalName,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info('Copying documents from concrete index to versioned index via ES _reindex API...');
  const reindexResult = await clientToUse.reindex(
    {
      source: { index: INDEX_NAME },
      dest: { index: physicalName },
      refresh: true,
    },
    { requestTimeout: 600000 },
  );
  logger.info({ total: reindexResult.total, created: reindexResult.created }, 'ES _reindex completed');

  const oldCount = await clientToUse.count({ index: INDEX_NAME });
  const newCount = await clientToUse.count({ index: physicalName });

  if (oldCount.count !== newCount.count) {
    await clientToUse.indices.delete({ index: physicalName }).catch(() => {});
    throw new Error(`Document count mismatch after migration: old=${oldCount.count}, new=${newCount.count}. Aborting.`);
  }

  logger.info({ count: newCount.count }, 'Document counts match. Swapping concrete index to alias...');

  await clientToUse.indices.delete({ index: INDEX_NAME });
  await clientToUse.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info(`Migration complete: '${INDEX_NAME}' is now an alias pointing to '${physicalName}'`);
}

function extractVersion(indexName: string): number {
  const match = indexName.match(/_v(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}
