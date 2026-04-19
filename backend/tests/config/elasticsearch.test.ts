import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

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

vi.mock('@elastic/elasticsearch', () => {
  class MockClient {
    security = {
      deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      deleteRole: (...args: unknown[]) => mockDeleteRole(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      putRole: (...args: unknown[]) => mockPutRole(...args),
      putUser: (...args: unknown[]) => mockPutUser(...args),
    };

    indices = {
      exists: (...args: unknown[]) => mockIndicesExists(...args),
      existsAlias: (...args: unknown[]) => mockIndicesExistsAlias(...args),
      getAlias: (...args: unknown[]) => mockIndicesGetAlias(...args),
      get: (...args: unknown[]) => mockIndicesGet(...args),
      create: (...args: unknown[]) => mockIndicesCreate(...args),
      delete: (...args: unknown[]) => mockIndicesDelete(...args),
      updateAliases: (...args: unknown[]) => mockIndicesUpdateAliases(...args),
    };
  }

  class MockHttpConnection {}

  return {
    Client: MockClient,
    HttpConnection: MockHttpConnection,
  };
});

const noop = vi.fn();
const logger: Record<string, unknown> = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
};

vi.mock('@config/log', () => ({
  logger,
}));

const {
  INDEX_NAME,
  initializeElasticsearchIndexWithClient,
  resetElasticsearchIndexWithClient,
  setupElasticsearchUser,
} = await import('@config/elasticsearch');
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupElasticsearchUser', () => {
  it('skips setup when ELASTICSEARCH_ADMIN_PASSWORD is missing', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: undefined,
      ELASTICSEARCH_USER: 'app_user',
    });

    const username = await setupElasticsearchUser({ configValues });

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

    await expect(setupElasticsearchUser({ configValues })).rejects.toThrow(
      'ELASTICSEARCH_PASSWORD is required to create the application user',
    );
  });

  it('upserts role but skips user creation when user exists and recreateIfExists is false', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_USER: 'existing_user',
    });
    mockGetUser.mockResolvedValue({ existing_user: {} });

    const username = await setupElasticsearchUser({ configValues });

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

    await setupElasticsearchUser({ configValues });

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
    const username = await setupElasticsearchUser({ recreateIfExists: true, configValues });

    expect(username).toBe(expectedUsername);
    expect(mockDeleteUser).toHaveBeenCalledWith({ username: expectedUsername });
    expect(mockDeleteRole).toHaveBeenCalledWith({ name: `${expectedUsername}_role` });
    expect(mockPutRole).toHaveBeenCalledTimes(1);
    expect(mockPutUser).toHaveBeenCalledTimes(1);
  });

  it('logs and rethrows unexpected Elasticsearch errors', async () => {
    const configValues = makeConfig({ ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret' });
    mockGetUser.mockRejectedValue({ meta: { statusCode: 500 }, message: 'es down' });

    await expect(setupElasticsearchUser({ configValues })).rejects.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('initializeElasticsearchIndexWithClient', () => {
  it('skips when alias already exists', async () => {
    mockIndicesExistsAlias.mockResolvedValue(true);
    mockIndicesGetAlias.mockResolvedValue({ [`${INDEX_NAME}_v1`]: {} });

    await initializeElasticsearchIndexWithClient(makeMockClient() as any);

    expect(mockIndicesCreate).not.toHaveBeenCalled();
  });

  it('warns when concrete index exists (legacy)', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(true);

    await initializeElasticsearchIndexWithClient(makeMockClient() as any);

    expect(mockIndicesCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('creates versioned index with alias when nothing exists', async () => {
    mockIndicesExistsAlias.mockResolvedValue(false);
    mockIndicesExists.mockResolvedValue(false);

    await initializeElasticsearchIndexWithClient(makeMockClient() as any);

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
