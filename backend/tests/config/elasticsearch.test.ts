import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDeleteUser = vi.fn();
const mockDeleteRole = vi.fn();
const mockGetUser = vi.fn();
const mockPutRole = vi.fn();
const mockPutUser = vi.fn();
const mockIndicesExists = vi.fn();
const mockIndicesExistsAlias = vi.fn();
const mockIndicesGetAlias = vi.fn();
const mockIndicesGet = vi.fn();
const mockIndicesCreate = vi.fn();
const mockIndicesDelete = vi.fn();
const mockIndicesUpdateAliases = vi.fn();
const mockIndicesRefresh = vi.fn();

// Every function under test takes a client, so nothing here needs to mock
// '@elastic/elasticsearch' itself -- the hand-rolled client below is enough.

// Spy on the real logger rather than vi.mock('@config/log'): a factory mock has
// to reproduce every export the module under test touches (httpLogger,
// buildHttpLoggerOptions, ...), and spying costs nothing. LOG_LEVEL=silent in
// .env.test keeps the output quiet.
const { logger } = await import('@config/log');

const {
  INDEX_NAME,
  initializeElasticsearchIndex,
  reindexZeroDowntime,
  resetElasticsearchIndexWithClient,
  setupElasticsearchUser,
} = await import('@config/elasticsearch');
const { ELASTICSEARCH_CLIENT_DEFAULTS } = await import('@config/elasticsearch-client');
const { config } = await import('@config/config');

function makeMockClient() {
  return {
    indices: {
      exists: mockIndicesExists,
      existsAlias: mockIndicesExistsAlias,
      getAlias: mockIndicesGetAlias,
      get: mockIndicesGet,
      create: mockIndicesCreate,
      delete: mockIndicesDelete,
      updateAliases: mockIndicesUpdateAliases,
      refresh: mockIndicesRefresh,
    },
    security: {
      deleteUser: mockDeleteUser,
      deleteRole: mockDeleteRole,
      getUser: mockGetUser,
      putRole: mockPutRole,
      putUser: mockPutUser,
    },
  };
}

function setupUser(options: Parameters<typeof setupElasticsearchUser>[0] = {}) {
  return setupElasticsearchUser({ adminClient: makeMockClient() as any, ...options });
}

type AppConfig = typeof config;

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...config, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockDeleteUser.mockResolvedValue(undefined);
  mockDeleteRole.mockResolvedValue(undefined);
  mockGetUser.mockRejectedValue({ meta: { statusCode: 404 } });
  mockPutRole.mockResolvedValue(undefined);
  mockPutUser.mockResolvedValue(undefined);
  mockIndicesExists.mockResolvedValue(false);
  mockIndicesExistsAlias.mockResolvedValue(false);
  mockIndicesGetAlias.mockRejectedValue({ meta: { statusCode: 404 } });
  mockIndicesGet.mockRejectedValue({ meta: { statusCode: 404 } });
  mockIndicesCreate.mockResolvedValue(undefined);
  mockIndicesDelete.mockResolvedValue(undefined);
  mockIndicesUpdateAliases.mockResolvedValue(undefined);
  mockIndicesRefresh.mockResolvedValue(undefined);

  vi.spyOn(logger, 'info');
  vi.spyOn(logger, 'warn');
  vi.spyOn(logger, 'error');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupElasticsearchUser', () => {
  it('preserves the Elasticsearch v8 default request timeout explicitly', () => {
    expect(ELASTICSEARCH_CLIENT_DEFAULTS).toEqual({ requestTimeout: 30_000 });
  });

  it('skips setup when ELASTICSEARCH_ADMIN_PASSWORD is missing', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: undefined,
      ELASTICSEARCH_USER: 'app_user',
    });

    const username = await setupUser({ configValues });

    expect(username).toBe('app_user');
    expect(logger.info).toHaveBeenCalledWith('ELASTICSEARCH_ADMIN_PASSWORD not set, skipping user/role setup');
    expect(mockPutRole).not.toHaveBeenCalled();
    expect(mockPutUser).not.toHaveBeenCalled();
  });

  it('throws when ELASTICSEARCH_PASSWORD is missing while admin setup is enabled', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_PASSWORD: '',
    });

    await expect(setupUser({ configValues })).rejects.toThrow(
      'ELASTICSEARCH_PASSWORD is required to create the application user',
    );
  });

  it('upserts role but skips user creation when user exists and recreateIfExists is false', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_USER: 'existing_user',
    });
    mockGetUser.mockResolvedValue({ existing_user: {} });

    const username = await setupUser({ configValues });

    expect(username).toBe('existing_user');
    expect(mockGetUser).toHaveBeenCalledWith({ username: 'existing_user' });
    expect(mockPutRole).toHaveBeenCalledTimes(1);
    expect(mockPutUser).not.toHaveBeenCalled();
  });

  it('includes wildcard pattern in role for versioned indices', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_USER: 'app_user',
    });
    mockGetUser.mockRejectedValue({ meta: { statusCode: 404 } });

    await setupUser({ configValues });

    const roleArgs = mockPutRole.mock.calls[0]?.[0];
    expect(roleArgs.indices[0].names).toEqual([INDEX_NAME, `${INDEX_NAME}_v*`]);
  });

  it('recreates role/user and ignores delete 404s when recreateIfExists is true', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_USER: '',
    });
    mockDeleteUser.mockRejectedValue({ meta: { statusCode: 404 } });
    mockDeleteRole.mockRejectedValue({ meta: { statusCode: 404 } });
    mockGetUser.mockRejectedValue({ meta: { statusCode: 404 } });

    const expectedUsername = `${INDEX_NAME.replace(/[^a-zA-Z0-9]/g, '_')}_user`;
    const username = await setupUser({ recreateIfExists: true, configValues });

    expect(username).toBe(expectedUsername);
    expect(mockDeleteUser).toHaveBeenCalledWith({ username: expectedUsername });
    expect(mockDeleteRole).toHaveBeenCalledWith({ name: `${expectedUsername}_role` });
    expect(mockPutRole).toHaveBeenCalledTimes(1);
    expect(mockPutUser).toHaveBeenCalledTimes(1);
  });

  it('logs and rethrows unexpected Elasticsearch errors', async () => {
    const configValues = makeConfig({ ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret' });
    mockGetUser.mockRejectedValue({ meta: { statusCode: 500 }, message: 'es down' });

    await expect(setupUser({ configValues })).rejects.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('surfaces connection errors that carry no meta instead of a TypeError', async () => {
    const configValues = makeConfig({ ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret' });
    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:9200');
    mockGetUser.mockRejectedValue(connectionError);

    await expect(setupUser({ configValues })).rejects.toBe(connectionError);
  });

  it('surfaces meta-less delete failures during recreate instead of a TypeError', async () => {
    const configValues = makeConfig({ ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret' });
    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:9200');
    mockDeleteUser.mockRejectedValue(connectionError);

    await expect(setupUser({ recreateIfExists: true, configValues })).rejects.toBe(connectionError);
  });
});

describe('initializeElasticsearchIndex', () => {
  it('skips when alias already exists', async () => {
    mockIndicesExistsAlias.mockResolvedValue(true);
    mockIndicesGetAlias.mockResolvedValue({ [`${INDEX_NAME}_v1`]: {} });

    await initializeElasticsearchIndex(makeMockClient() as any);

    expect(mockIndicesCreate).not.toHaveBeenCalled();
  });

  it('warns when concrete index exists (legacy)', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(true);

    await initializeElasticsearchIndex(makeMockClient() as any);

    expect(mockIndicesCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('creates versioned index with alias when nothing exists', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(false);

    await initializeElasticsearchIndex(makeMockClient() as any);

    expect(mockIndicesCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockIndicesCreate.mock.calls[0]?.[0];
    expect(createArgs.index).toBe(`${INDEX_NAME}_v1`);
    expect(createArgs.settings).toBeDefined();
    expect(createArgs.mappings).toBeDefined();

    expect(mockIndicesUpdateAliases).toHaveBeenCalledWith({
      actions: [{ add: { index: `${INDEX_NAME}_v1`, alias: INDEX_NAME, is_write_index: true } }],
    });
  });
});

describe('resetElasticsearchIndexWithClient', () => {
  it('deletes aliased versioned indices and recreates', async () => {
    mockIndicesExistsAlias.mockResolvedValue(true);
    mockIndicesGet.mockResolvedValue({ [`${INDEX_NAME}_v2`]: {}, [`${INDEX_NAME}_v1`]: {} });

    await resetElasticsearchIndexWithClient(makeMockClient() as any);

    expect(mockIndicesDelete).toHaveBeenCalledWith({ index: `${INDEX_NAME}_v2` });
    expect(mockIndicesDelete).toHaveBeenCalledWith({ index: `${INDEX_NAME}_v1` });
    expect(mockIndicesCreate).toHaveBeenCalledWith(expect.objectContaining({ index: `${INDEX_NAME}_v1` }));
    expect(mockIndicesUpdateAliases).toHaveBeenCalledWith({
      actions: [{ add: { index: `${INDEX_NAME}_v1`, alias: INDEX_NAME, is_write_index: true } }],
    });
  });

  it('deletes concrete index (legacy) and creates versioned with alias', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(true);

    await resetElasticsearchIndexWithClient(makeMockClient() as any);

    expect(mockIndicesDelete).toHaveBeenCalledWith({ index: INDEX_NAME });
    expect(mockIndicesCreate).toHaveBeenCalledWith(expect.objectContaining({ index: `${INDEX_NAME}_v1` }));
  });

  it('creates index when nothing exists', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(false);

    await resetElasticsearchIndexWithClient(makeMockClient() as any);

    expect(mockIndicesDelete).not.toHaveBeenCalled();
    expect(mockIndicesCreate).toHaveBeenCalledTimes(1);
  });
});

describe('reindexZeroDowntime', () => {
  it('does not swap the alias when population reports bulk failures', async () => {
    mockIndicesGetAlias.mockResolvedValue({ [`${INDEX_NAME}_v1`]: {} });
    const populate = vi.fn().mockResolvedValue({
      success: false,
      message: 'Reindex completed with 1 failed document(s)',
      stats: { totalSegments: 1, successfulIndexes: 0, failedIndexes: 1, mediaProcessed: 1 },
      errors: [{ segmentId: 1, error: 'mapper failure' }],
    });

    await expect(reindexZeroDowntime(populate, makeMockClient() as any)).rejects.toThrow('Reindex population failed');

    expect(mockIndicesUpdateAliases).not.toHaveBeenCalled();
    expect(mockIndicesDelete).toHaveBeenCalledWith({ index: `${INDEX_NAME}_v2` });
  });
});
