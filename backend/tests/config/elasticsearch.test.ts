import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const mockDeleteUser = vi.fn();
const mockDeleteRole = vi.fn();
const mockGetUser = vi.fn();
const mockPutRole = vi.fn();
const mockPutUser = vi.fn();
const mockIndicesExists = vi.fn();
const mockIndicesCreate = vi.fn();
const mockIndicesDelete = vi.fn();

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
      create: (...args: unknown[]) => mockIndicesCreate(...args),
      delete: (...args: unknown[]) => mockIndicesDelete(...args),
    };
  }

  class MockHttpConnection {}

  return {
    Client: MockClient,
    HttpConnection: MockHttpConnection,
  };
});

const logger = {
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock('@config/log', () => ({
  logger,
}));

const {
  INDEX_NAME,
  client,
  initializeElasticsearchIndex,
  initializeElasticsearchIndexWithClient,
  resetElasticsearchIndex,
  resetElasticsearchIndexWithClient,
  setupElasticsearchUser,
} = await import('@config/elasticsearch');
const { config } = await import('@config/config');

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
  mockIndicesCreate.mockResolvedValue(undefined);
  mockIndicesDelete.mockResolvedValue(undefined);
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

  it('returns early when user exists and recreateIfExists is false', async () => {
    const configValues = makeConfig({
      ELASTICSEARCH_ADMIN_PASSWORD: 'admin-secret',
      ELASTICSEARCH_USER: 'existing_user',
    });
    mockGetUser.mockResolvedValue({ existing_user: {} });

    const username = await setupElasticsearchUser({ configValues });

    expect(username).toBe('existing_user');
    expect(mockGetUser).toHaveBeenCalledWith({ username: 'existing_user' });
    expect(mockPutRole).not.toHaveBeenCalled();
    expect(mockPutUser).not.toHaveBeenCalled();
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
  it('skips index creation when index already exists', async () => {
    const esClient = {
      indices: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
      },
    };

    await initializeElasticsearchIndexWithClient(esClient as any);

    expect(esClient.indices.create).not.toHaveBeenCalled();
  });

  it('creates index from schema when missing', async () => {
    const esClient = {
      indices: {
        exists: vi.fn(async () => false),
        create: vi.fn(async () => undefined),
      },
    };

    await initializeElasticsearchIndexWithClient(esClient as any);

    expect(esClient.indices.create).toHaveBeenCalledTimes(1);
    const createArgs = (esClient.indices.create as any).mock.calls[0]?.[0];
    expect(createArgs.index).toBe(INDEX_NAME);
    expect(createArgs.settings).toBeDefined();
    expect(createArgs.mappings).toBeDefined();
  });

  it('delegates initializeElasticsearchIndex() to the default client', async () => {
    const existsSpy = vi.spyOn((client as any).indices, 'exists').mockResolvedValueOnce(false);
    const createSpy = vi.spyOn((client as any).indices, 'create').mockResolvedValueOnce(undefined);

    await initializeElasticsearchIndex();

    expect(existsSpy).toHaveBeenCalledWith({ index: INDEX_NAME });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resetElasticsearchIndexWithClient', () => {
  it('deletes existing index and recreates it', async () => {
    const esClient = {
      indices: {
        exists: vi.fn(async () => true),
        delete: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
      },
    };

    await resetElasticsearchIndexWithClient(esClient as any);

    expect(esClient.indices.delete).toHaveBeenCalledWith({ index: INDEX_NAME });
    expect(esClient.indices.create).toHaveBeenCalledTimes(1);
  });

  it('creates index when none exists', async () => {
    const esClient = {
      indices: {
        exists: vi.fn(async () => false),
        delete: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
      },
    };

    await resetElasticsearchIndexWithClient(esClient as any);

    expect(esClient.indices.delete).not.toHaveBeenCalled();
    expect(esClient.indices.create).toHaveBeenCalledTimes(1);
  });

  it('delegates resetElasticsearchIndex() to the default client', async () => {
    const existsSpy = vi.spyOn((client as any).indices, 'exists').mockResolvedValueOnce(true);
    const deleteSpy = vi.spyOn((client as any).indices, 'delete').mockResolvedValueOnce(undefined);
    const createSpy = vi.spyOn((client as any).indices, 'create').mockResolvedValueOnce(undefined);

    await resetElasticsearchIndex();

    expect(existsSpy).toHaveBeenCalledWith({ index: INDEX_NAME });
    expect(deleteSpy).toHaveBeenCalledWith({ index: INDEX_NAME });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
