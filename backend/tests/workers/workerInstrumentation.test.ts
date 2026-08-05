import { describe, expect, it, vi } from 'vitest';
import { observeQueueSizes } from '@app/workers/workerInstrumentation';

describe('observeQueueSizes', () => {
  it('observes known queues and skips null or rejected lookups', async () => {
    const getQueue = vi.fn(async (queue: string) => {
      if (queue === 'missing') return null;
      if (queue === 'broken') throw new Error('queue lookup failed');
      return { queuedCount: 2, activeCount: 3, deferredCount: 4 };
    });

    const observe = vi.fn();
    await observeQueueSizes({ getQueue } as any, ['known', 'missing', 'broken'], { observe });

    expect(getQueue).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledWith(2, { 'pgboss.queue': 'known', 'pgboss.state': 'queued' });
    expect(observe).toHaveBeenCalledWith(3, { 'pgboss.queue': 'known', 'pgboss.state': 'active' });
    expect(observe).toHaveBeenCalledWith(4, { 'pgboss.queue': 'known', 'pgboss.state': 'deferred' });
  });
});
