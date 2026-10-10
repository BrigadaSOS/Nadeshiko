import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { active, completed } = vi.hoisted(() => ({ active: vi.fn(), completed: vi.fn() }));
vi.mock('@opentelemetry/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@opentelemetry/api')>()),
  metrics: {
    getMeter: () => ({
      createUpDownCounter: () => ({ add: active }),
      createCounter: (name: string) => ({ add: name === 'http.server.requests' ? completed : vi.fn() }),
    }),
  },
}));
vi.mock('#shared/utils/traffic', () => ({
  TRAFFIC_ATTRIBUTE: 'traffic',
  BOT_FAMILY_ATTRIBUTE: 'bot.family',
  resolveEventTraffic: () => ({ traffic: 'reader' }),
  trafficAttributes: () => ({ traffic: 'reader' }),
}));

describe('request metrics on disconnect', () => {
  let request: (event: unknown) => void;
  beforeEach(async () => {
    active.mockClear();
    completed.mockClear();
    vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn);
    const plugin = (await import('./00-telemetry')).default;
    plugin({
      hooks: {
        hook: (name: string, fn: typeof request) => {
          if (name === 'request') request = fn;
        },
      },
    } as never);
  });
  afterEach(() => vi.unstubAllGlobals());
  const event = () => ({
    path: '/en/search/word',
    context: {},
    node: {
      req: { method: 'GET' },
      res: Object.assign(new EventEmitter(), { statusCode: 200, destroyed: false, writableEnded: false }),
    },
  });

  it('releases a disconnected request without counting a completed response', () => {
    const e = event();
    request(e);
    e.node.res.emit('close');
    e.node.res.emit('finish');
    expect(active.mock.calls.map(([value]) => value)).toEqual([1, -1]);
    expect(active.mock.calls[0][1]).toEqual(active.mock.calls[1][1]);
    expect(completed).not.toHaveBeenCalled();
  });
  it('counts a normal response once and releases once even though close also fires', () => {
    const e = event();
    request(e);
    e.node.res.emit('finish');
    e.node.res.emit('close');
    expect(active.mock.calls.map(([value]) => value)).toEqual([1, -1]);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith(1, expect.objectContaining({ 'http.status_class': '2xx' }));
  });
  it('does not count a response that disconnected before the request hook ran', () => {
    const e = event();
    e.node.res.destroyed = true;
    request(e);
    expect(active).not.toHaveBeenCalled();
  });
});
