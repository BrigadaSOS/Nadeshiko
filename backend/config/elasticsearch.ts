import { Client, HttpConnection } from '@elastic/elasticsearch';
import { config, type AppConfig } from '@config/config';
import { logger } from '@config/log';
import elasticsearchSchema from 'config/elasticsearch-schema.json';

export const INDEX_NAME = config.ELASTICSEARCH_INDEX || elasticsearchSchema.index;

export const client = new Client({
  node: config.ELASTICSEARCH_HOST,
  auth: {
    username: config.ELASTICSEARCH_USER,
    password: config.ELASTICSEARCH_PASSWORD,
  },
  Connection: HttpConnection,
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
  });
}

/**
 * Sets up the Elasticsearch application user and role.
 * Creates an index-scoped user that can only access the configured index.
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
  const indexName = configValues.ELASTICSEARCH_INDEX || elasticsearchSchema.index;
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
      indices: [{ names: [indexName], privileges: ['all'], allow_restricted_indices: false }],
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

export async function initializeElasticsearchIndex(): Promise<void> {
  await initializeElasticsearchIndexWithClient(client);
}

export async function initializeElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;
  await initializeElasticsearchIndexInternal(clientToUse);
}

async function initializeElasticsearchIndexInternal(clientToUse: Client): Promise<void> {
  const indexExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (indexExists) {
    logger.info(`Elasticsearch index '${INDEX_NAME}' already exists`);
    return;
  }

  logger.info(`Creating Elasticsearch index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);

  await clientToUse.indices.create({
    index: INDEX_NAME,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' created successfully from config/elasticsearch-schema.json`);
}

export async function resetElasticsearchIndex(): Promise<void> {
  await resetElasticsearchIndexWithClient(client);
}

export async function resetElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;

  const indexExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (indexExists) {
    logger.info(`Deleting Elasticsearch index '${INDEX_NAME}'`);
    await clientToUse.indices.delete({ index: INDEX_NAME });
  }

  logger.info(`Creating Elasticsearch index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);

  await clientToUse.indices.create({
    index: INDEX_NAME,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' recreated successfully`);
}
