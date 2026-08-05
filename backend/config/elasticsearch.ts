import { Client, HttpConnection } from '@elastic/elasticsearch';
import { config, type AppConfig } from '@config/config';
import { logger } from '@config/log';
import { ELASTICSEARCH_CLIENT_DEFAULTS } from '@config/elasticsearch-client';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type { IndicesIndexSettings, MappingTypeMapping } from '@elastic/elasticsearch/lib/api/types';
import type { ReindexResponse } from '@app/services/search/segmentDocument/SegmentIndexer';
import { isElasticsearchNotFound } from '@lib/elasticsearchErrors';

/**
 * The index definition, asserted to the client's types once here rather than at
 * each of the four call sites that create an index.
 *
 * TypeScript infers a JSON import as its literal shape, which never structurally
 * satisfies Elasticsearch's settings/mapping types (analyzers and field types are
 * open-ended string unions there). This is the one place that gap is bridged, so
 * a schema edit that the client would reject is a mismatch to reason about here
 * instead of four separately-silenced `any`s.
 */
const indexSchema: { settings: IndicesIndexSettings; mappings: MappingTypeMapping } = {
  // Via `unknown` because the inferred literal type and the client's open-ended
  // union types do not overlap enough for a direct assertion -- which is exactly
  // what the previous `as any` was hiding, four times over.
  settings: elasticsearchSchema.settings as unknown as IndicesIndexSettings,
  mappings: elasticsearchSchema.mappings as unknown as MappingTypeMapping,
};

export const INDEX_NAME = config.ELASTICSEARCH_INDEX;

export const client = new Client({
  node: config.ELASTICSEARCH_HOST,
  auth: {
    username: config.ELASTICSEARCH_USER,
    password: config.ELASTICSEARCH_PASSWORD,
  },
  Connection: HttpConnection,
  ...ELASTICSEARCH_CLIENT_DEFAULTS,
});

/**
 * Creates an admin client using ELASTICSEARCH_ADMIN_* credentials.
 * Only used for setup operations (creating users/roles).
 */
export function createAdminClient(configValues: AppConfig): Client {
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
    ...ELASTICSEARCH_CLIENT_DEFAULTS,
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
 * `adminClient` exists so tests can supply a double instead of mocking
 * `@elastic/elasticsearch`, which would replace the module process-wide.
 *
 * @returns The username that was created (or already existed)
 */
export async function setupElasticsearchUser(
  options: { recreateIfExists?: boolean; configValues?: AppConfig; adminClient?: Client } = {},
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

  const adminClient = options.adminClient ?? createAdminClient(configValues);

  try {
    if (recreateIfExists) {
      logger.info({ username, roleName }, 'Recreating Elasticsearch app user and role');

      await adminClient.security.deleteUser({ username }).catch((error) => {
        if (!isElasticsearchNotFound(error)) throw error;
      });

      await adminClient.security.deleteRole({ name: roleName }).catch((error) => {
        if (!isElasticsearchNotFound(error)) throw error;
      });
    }

    const userExists = await adminClient.security
      .getUser({ username })
      .then(() => true)
      .catch((error) => {
        if (isElasticsearchNotFound(error)) return false;
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

export async function resolvePhysicalIndex(esClient: Client = client): Promise<string | null> {
  try {
    const aliasResponse = await esClient.indices.getAlias({ name: INDEX_NAME });
    const indices = Object.keys(aliasResponse);
    return indices[0] ?? null;
  } catch (error) {
    if (isElasticsearchNotFound(error)) return null;
    throw error;
  }
}

function nextVersionName(current: string | null): string {
  if (!current) return `${INDEX_NAME}_v1`;

  const match = current.match(/_v(\d+)$/);
  if (!match?.[1]) return `${INDEX_NAME}_v1`;

  const nextVersion = parseInt(match[1], 10) + 1;
  return `${INDEX_NAME}_v${nextVersion}`;
}

export async function listVersionedIndices(esClient: Client = client): Promise<string[]> {
  try {
    const response = await esClient.indices.get({ index: `${INDEX_NAME}_v*` });
    return Object.keys(response).sort();
  } catch (error) {
    if (isElasticsearchNotFound(error)) return [];
    throw error;
  }
}

export async function initializeElasticsearchIndex(esClient: Client = client): Promise<void> {
  const aliasExists = await esClient.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    const physical = await resolvePhysicalIndex(esClient);
    logger.info({ alias: INDEX_NAME, physical }, 'Elasticsearch alias exists');
    return;
  }

  const concreteExists = await esClient.indices.exists({ index: INDEX_NAME });
  if (concreteExists) {
    logger.warn(
      `Elasticsearch index '${INDEX_NAME}' exists as a concrete index (legacy). Run 'node --import tsx bin/es.ts migrate' to convert to alias-based setup.`,
    );
    return;
  }

  const physicalName = `${INDEX_NAME}_v1`;
  logger.info({ index: physicalName, alias: INDEX_NAME }, 'Creating Elasticsearch index');

  await esClient.indices.create({
    index: physicalName,
    settings: indexSchema.settings,
    mappings: indexSchema.mappings,
  });

  await esClient.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info({ index: physicalName, alias: INDEX_NAME }, 'Elasticsearch index created');
}

export async function resetElasticsearchIndex(): Promise<void> {
  await resetElasticsearchIndexWithClient(client);
}

export async function resetElasticsearchIndexWithClient(esClient: Client = client): Promise<void> {
  const aliasExists = await esClient.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    const allVersioned = await listVersionedIndices(esClient);
    for (const idx of allVersioned) {
      await esClient.indices.delete({ index: idx });
    }
    logger.info({ alias: INDEX_NAME, count: allVersioned.length }, 'Deleted alias and versioned indices');
  } else {
    const concreteExists = await esClient.indices.exists({ index: INDEX_NAME });
    if (concreteExists) {
      await esClient.indices.delete({ index: INDEX_NAME });
    }
  }

  const physicalName = `${INDEX_NAME}_v1`;
  await esClient.indices.create({
    index: physicalName,
    settings: indexSchema.settings,
    mappings: indexSchema.mappings,
  });

  await esClient.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info({ index: physicalName, alias: INDEX_NAME }, 'Elasticsearch index recreated');
}

export async function reindexZeroDowntime(
  populateFn: (targetIndex: string) => Promise<ReindexResponse>,
  esClient: Client = client,
): Promise<ReindexResponse> {
  const currentPhysical = await resolvePhysicalIndex(esClient);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist. Run initialization first.`);
  }

  const newPhysical = nextVersionName(currentPhysical);
  logger.info({ currentPhysical, newPhysical }, 'Starting zero-downtime reindex');

  await esClient.indices.create({
    index: newPhysical,
    settings: indexSchema.settings,
    mappings: indexSchema.mappings,
  });

  try {
    const result = await populateFn(newPhysical);

    if (!result.success) {
      throw new Error(`Reindex population failed: ${result.message}`);
    }

    await esClient.indices.refresh({ index: newPhysical });

    await esClient.indices.updateAliases({
      actions: [
        { remove: { index: currentPhysical, alias: INDEX_NAME } },
        { add: { index: newPhysical, alias: INDEX_NAME, is_write_index: true } },
      ],
    });

    logger.info({ currentPhysical, newPhysical }, 'Alias swapped successfully. Old index kept for rollback.');

    return result;
  } catch (error) {
    logger.error({ newPhysical, error }, 'Zero-downtime reindex failed, cleaning up new index');
    await esClient.indices.delete({ index: newPhysical }).catch((deleteError) => {
      logger.warn({ newPhysical, deleteError }, 'Failed to clean up new index after reindex failure');
    });
    throw error;
  }
}

export async function rollbackAlias(esClient: Client = client): Promise<{ from: string; to: string }> {
  const currentPhysical = await resolvePhysicalIndex(esClient);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist.`);
  }

  const allVersioned = await listVersionedIndices(esClient);
  const currentVersion = extractVersion(currentPhysical);

  const previousIndices = allVersioned
    .filter((idx) => idx !== currentPhysical)
    .filter((idx) => extractVersion(idx) < currentVersion)
    .sort((a, b) => extractVersion(b) - extractVersion(a));

  const rollbackTarget = previousIndices[0];
  if (!rollbackTarget) {
    throw new Error('No previous index available for rollback.');
  }

  await esClient.indices.updateAliases({
    actions: [
      { remove: { index: currentPhysical, alias: INDEX_NAME } },
      { add: { index: rollbackTarget, alias: INDEX_NAME, is_write_index: true } },
    ],
  });

  logger.info({ from: currentPhysical, to: rollbackTarget }, 'Alias rolled back successfully');

  return { from: currentPhysical, to: rollbackTarget };
}

export async function cleanupOldIndices(esClient: Client = client): Promise<string[]> {
  const currentPhysical = await resolvePhysicalIndex(esClient);
  if (!currentPhysical) {
    throw new Error(`Alias '${INDEX_NAME}' does not exist.`);
  }

  const allVersioned = await listVersionedIndices(esClient);
  const toDelete = allVersioned.filter((idx) => idx !== currentPhysical);

  for (const idx of toDelete) {
    await esClient.indices.delete({ index: idx });
    logger.info({ index: idx }, 'Deleted old versioned index');
  }

  return toDelete;
}

export async function migrateToAlias(esClient: Client = client): Promise<void> {
  const aliasExists = await esClient.indices.existsAlias({ name: INDEX_NAME });
  if (aliasExists) {
    logger.info({ alias: INDEX_NAME }, 'Already an alias, no migration needed');
    return;
  }

  const concreteExists = await esClient.indices.exists({ index: INDEX_NAME });
  if (!concreteExists) {
    throw new Error(`Neither alias nor concrete index '${INDEX_NAME}' exists. Run initialization first.`);
  }

  const physicalName = `${INDEX_NAME}_v1`;
  logger.info({ source: INDEX_NAME, target: physicalName }, 'Migrating concrete index to alias-based setup');

  await esClient.indices.create({
    index: physicalName,
    settings: indexSchema.settings,
    mappings: indexSchema.mappings,
  });

  logger.info('Copying documents from concrete index to versioned index via ES _reindex API...');
  const reindexResult = await esClient.reindex(
    {
      source: { index: INDEX_NAME },
      dest: { index: physicalName },
      refresh: true,
    },
    { requestTimeout: 600000 },
  );
  logger.info({ total: reindexResult.total, created: reindexResult.created }, 'ES _reindex completed');

  const oldCount = await esClient.count({ index: INDEX_NAME });
  const newCount = await esClient.count({ index: physicalName });

  if (oldCount.count !== newCount.count) {
    await esClient.indices.delete({ index: physicalName }).catch(() => {});
    throw new Error(`Document count mismatch after migration: old=${oldCount.count}, new=${newCount.count}. Aborting.`);
  }

  logger.info({ count: newCount.count }, 'Document counts match. Swapping concrete index to alias...');

  await esClient.indices.delete({ index: INDEX_NAME });
  await esClient.indices.updateAliases({
    actions: [{ add: { index: physicalName, alias: INDEX_NAME, is_write_index: true } }],
  });

  logger.info({ alias: INDEX_NAME, physical: physicalName }, 'Migration complete');
}

function extractVersion(indexName: string): number {
  const match = indexName.match(/_v(\d+)$/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}
