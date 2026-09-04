import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const mocks = vi.hoisted(() => ({
  boss: {
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    createQueue: vi.fn(),
    updateQueue: vi.fn(),
    schedule: vi.fn(),
  },
  registerEsSyncWorkers: vi.fn(),
  setBossInstance: vi.fn(),
  registerQueueMetrics: vi.fn(),
}));

vi.mock('pg-boss', () => ({
  PgBoss: class {
    on = mocks.boss.on;
    start = mocks.boss.start;
    stop = mocks.boss.stop;
    createQueue = mocks.boss.createQueue;
    updateQueue = mocks.boss.updateQueue;
    schedule = mocks.boss.schedule;
  },
}));

vi.mock('@config/postgresConfig', () => ({
  getAppPostgresConfig: () => ({ host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' }),
}));
vi.mock('@config/log', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@app/workers/esSyncWorker', () => ({ registerEsSyncWorkers: mocks.registerEsSyncWorkers }));
vi.mock('@app/workers/pgBossClient', () => ({ setBossInstance: mocks.setBossInstance }));
vi.mock('@app/workers/workerInstrumentation', () => ({ registerQueueMetrics: mocks.registerQueueMetrics }));
vi.mock('@app/workers/emailWorker', () => ({ registerEmailWorkers: vi.fn() }));
vi.mock('@app/workers/emailLifecycleWorker', () => ({ registerEmailLifecycleWorker: vi.fn() }));
vi.mock('@app/workers/activityRetentionWorker', () => ({ registerActivityRetentionWorker: vi.fn() }));
vi.mock('@app/workers/affinityRetentionWorker', () => ({ registerAffinityRetentionWorker: vi.fn() }));
vi.mock('@app/workers/tokenParseWorker', () => ({ registerTokenParseWorker: vi.fn() }));

import { workersInitializer } from '@config/initializers/workers';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from '@app/workers/queueNames';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boss.start.mockResolvedValue(undefined);
  mocks.boss.stop.mockResolvedValue(undefined);
  mocks.boss.createQueue.mockResolvedValue(undefined);
  mocks.boss.updateQueue.mockResolvedValue(undefined);
  mocks.boss.schedule.mockResolvedValue(undefined);
});

describe('workers initializer', () => {
  it('updates the retry delay on existing ES queues after createQueue', async () => {
    const context = { app: express(), server: null };
    await workersInitializer.initialize(context);

    expect(mocks.boss.updateQueue).toHaveBeenCalledTimes(3);
    expect(mocks.boss.updateQueue).toHaveBeenNthCalledWith(1, ES_SYNC_CREATE_QUEUE, { retryDelay: 1 });
    expect(mocks.boss.updateQueue).toHaveBeenNthCalledWith(2, ES_SYNC_UPDATE_QUEUE, { retryDelay: 1 });
    expect(mocks.boss.updateQueue).toHaveBeenNthCalledWith(3, ES_SYNC_DELETE_QUEUE, { retryDelay: 1 });
    expect(mocks.boss.createQueue.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.boss.updateQueue.mock.invocationCallOrder[0]!,
    );

    await workersInitializer.shutdown?.(context);
  });
});
