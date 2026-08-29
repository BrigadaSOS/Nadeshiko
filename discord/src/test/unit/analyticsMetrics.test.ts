import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The OTel half of `analytics.ts`, which `analytics.test.ts` deliberately does
 * not touch -- that file is about the PostHog privacy contract.
 *
 * What is worth protecting here is cardinality. The metric store is shared with
 * another project, and a label whose range is unbounded does not fail: it is
 * accepted, retained, and quietly grows the store forever. Both guards against
 * that (the 250-guild series cap and the "is the bot actually in this server"
 * predicate) are invisible in normal operation, which is exactly why they are
 * asserted rather than trusted.
 */
type GaugeCallback = (result: { observe: (value: number, attrs?: Record<string, unknown>) => void }) => void;

const gaugeCallbacks = new Map<string, GaugeCallback>();
const counterAdds = new Map<string, { value: number; attrs?: Record<string, unknown> }[]>();
const histogramRecords: { name: string; value: number; attrs?: Record<string, unknown> }[] = [];

const captureSpy = vi.fn();
const captureExceptionSpy = vi.fn();
const groupIdentifySpy = vi.fn();
const shutdownSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = captureSpy;
    captureException = captureExceptionSpy;
    groupIdentify = groupIdentifySpy;
    shutdown = shutdownSpy;
  },
}));

vi.mock('../../telemetry', () => ({
  getMeter: () => ({
    createHistogram: (name: string) => ({
      record: (value: number, attrs?: Record<string, unknown>) => histogramRecords.push({ name, value, attrs }),
    }),
    createCounter: (name: string) => ({
      add: (value: number, attrs?: Record<string, unknown>) => {
        counterAdds.set(name, [...(counterAdds.get(name) ?? []), { value, attrs }]);
      },
    }),
    createObservableGauge: (name: string) => ({
      addCallback: (cb: GaugeCallback) => gaugeCallbacks.set(name, cb),
    }),
  }),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

/** Everything a gauge callback observed, in call order. */
function readGauge(name: string) {
  const observations: { value: number; attrs?: Record<string, unknown> }[] = [];
  gaugeCallbacks.get(name)?.({ observe: (value, attrs) => observations.push({ value, attrs }) });
  return observations;
}

function guilds(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `g-${i}`, name: `Server ${i}`, memberCount: 100 + i }));
}

async function loadAnalytics() {
  vi.resetModules();
  gaugeCallbacks.clear();
  counterAdds.clear();
  histogramRecords.length = 0;
  captureSpy.mockClear();
  captureExceptionSpy.mockClear();
  groupIdentifySpy.mockClear();
  shutdownSpy.mockClear();
  vi.stubEnv('POSTHOG_PROJECT_API_KEY', 'phc_test');
  vi.stubEnv('DISCORD_ANALYTICS_SALT', 'salt');
  return import('../../analytics');
}

let analytics: typeof import('../../analytics');

beforeEach(async () => {
  analytics = await loadAnalytics();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('guild gauges', () => {
  test('report nothing at all before the client is ready', () => {
    // The gauges are registered at import time but the cache only exists once
    // discord.js has connected. Observing a zero here would draw a graph
    // claiming the bot left every server on each restart.
    expect(readGauge('discord.guilds')).toEqual([]);
    expect(readGauge('discord.guild.info')).toEqual([]);
    expect(readGauge('discord.guild.members')).toEqual([]);
  });

  test('report the server count once the cache is bound', () => {
    analytics.bindGuilds(() => guilds(3));

    expect(readGauge('discord.guilds')).toEqual([{ value: 3, attrs: undefined }]);
  });

  test('read the cache fresh on every collection, so a restart does not reset them', () => {
    // This is why they are observable gauges rather than counters incremented
    // on guildCreate: the client's cache is the truth.
    let count = 2;
    analytics.bindGuilds(() => guilds(count));
    expect(readGauge('discord.guilds')[0].value).toBe(2);

    count = 5;
    expect(readGauge('discord.guilds')[0].value).toBe(5);
  });

  test('emit one info series per server, carrying its name', () => {
    analytics.bindGuilds(() => guilds(2));

    expect(readGauge('discord.guild.info')).toEqual([
      { value: 1, attrs: { guild_id: 'g-0', guild_name: 'Server 0' } },
      { value: 1, attrs: { guild_id: 'g-1', guild_name: 'Server 1' } },
    ]);
  });

  test('truncate a server name, because a label is not a text field', () => {
    // Server names are user-chosen. A 500-character one would otherwise be
    // carried on every scrape, forever.
    analytics.bindGuilds(() => [{ id: 'g-0', name: 'x'.repeat(500), memberCount: 1 }]);

    expect((readGauge('discord.guild.info')[0].attrs as { guild_name: string }).guild_name).toHaveLength(100);
  });

  test('report member counts per server', () => {
    analytics.bindGuilds(() => guilds(2));

    expect(readGauge('discord.guild.members')).toEqual([
      { value: 100, attrs: { guild_id: 'g-0' } },
      { value: 101, attrs: { guild_id: 'g-1' } },
    ]);
  });

  test('stop emitting per-guild series past the cap, rather than filling a shared store', () => {
    // The bot getting listed in a directory and landing in thousands of servers
    // is the good problem this keeps from also being an incident.
    analytics.bindGuilds(() => guilds(251));

    expect(readGauge('discord.guild.info')).toEqual([]);
    expect(readGauge('discord.guild.members')).toEqual([]);
  });

  test('the plain server count survives past the cap, since it is a single series', () => {
    analytics.bindGuilds(() => guilds(251));

    expect(readGauge('discord.guilds')).toEqual([{ value: 251, attrs: undefined }]);
  });

  test('emit right up to the cap', () => {
    analytics.bindGuilds(() => guilds(250));

    expect(readGauge('discord.guild.info')).toHaveLength(250);
  });
});

describe('recordInteraction', () => {
  const base = {
    kind: 'command' as const,
    name: 'search',
    surface: 'slash',
    actor: { userId: 'u-1', guildId: 'g-1' },
    durationSeconds: 0.25,
  };

  test('records the duration with its status', () => {
    analytics.recordInteraction(base);

    expect(histogramRecords).toContainEqual({
      name: 'discord.interaction.duration',
      value: 0.25,
      attrs: { kind: 'command', name: 'search', surface: 'slash', status: 'ok' },
    });
  });

  test('counts an error separately, tagged with the error class', () => {
    analytics.recordInteraction({ ...base, error: new TypeError('boom') });

    expect(counterAdds.get('discord.interaction.errors')).toEqual([
      { value: 1, attrs: { kind: 'command', name: 'search', surface: 'slash', error_type: 'TypeError' } },
    ]);
  });

  test('labels a thrown non-Error by its typeof rather than crashing on `.name`', () => {
    // `throw 'nope'` is legal and does happen, usually from a library.
    analytics.recordInteraction({ ...base, error: 'nope' });

    expect(counterAdds.get('discord.interaction.errors')?.[0].attrs).toMatchObject({ error_type: 'string' });
  });

  test('counts per-guild usage for a server the bot is actually in', () => {
    analytics.bindGuildMembership((id) => id === 'g-1');

    analytics.recordInteraction(base);

    expect(counterAdds.get('discord.guild.interactions')).toEqual([
      { value: 1, attrs: { guild_id: 'g-1', status: 'ok' } },
    ]);
  });

  test('drops the guild label for a server the bot has never joined', () => {
    // A user-installed command travels with the person and fires in servers the
    // bot is not in. That guild id is an unbounded label.
    analytics.bindGuildMembership(() => false);

    analytics.recordInteraction(base);

    expect(counterAdds.get('discord.guild.interactions')).toBeUndefined();
  });

  test('drops the guild label when no membership predicate was ever bound', () => {
    analytics.recordInteraction(base);

    expect(counterAdds.get('discord.guild.interactions')).toBeUndefined();
  });

  test('records nothing guild-scoped for a DM', () => {
    analytics.bindGuildMembership(() => true);

    analytics.recordInteraction({ ...base, actor: { userId: 'u-1', guildId: null } });

    expect(counterAdds.get('discord.guild.interactions')).toBeUndefined();
  });

  test('still reaches PostHog for an interaction outside a joined server', () => {
    // The usage is not lost -- only the metric label is dropped. PostHog is
    // built for that cardinality.
    analytics.bindGuildMembership(() => false);

    analytics.recordInteraction(base);

    expect(captureSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'bot_interaction' }));
  });
});

describe('recordRateLimit and recordLinkEmitted', () => {
  test('a rate limit is labelled global or per-route', () => {
    analytics.recordRateLimit(true);
    analytics.recordRateLimit(false);

    expect(counterAdds.get('discord.rate_limited')).toEqual([
      { value: 1, attrs: { global: 'true' } },
      { value: 1, attrs: { global: 'false' } },
    ]);
  });

  test('an emitted link is counted by destination and surface, with no actor attached', () => {
    // Deliberately unattributed: the arrivals are counted on the web side, so
    // only the denominator is missing and it does not need to know who.
    analytics.recordLinkEmitted({ target: 'sentence', surface: 'search' });

    expect(counterAdds.get('discord.links.emitted')).toEqual([
      { value: 1, attrs: { target: 'sentence', surface: 'search' } },
    ]);
  });
});

describe('guild lifecycle', () => {
  test('identifyGuild names the PostHog group, so a breakdown is readable', () => {
    analytics.identifyGuild({ id: 'g-1', name: 'Study Group', memberCount: 300 });

    expect(groupIdentifySpy).toHaveBeenCalledWith({
      groupType: 'guild',
      groupKey: 'g-1',
      properties: { name: 'Study Group', member_count: 300 },
    });
  });

  test('a failure to identify a guild never propagates into the ready handler', () => {
    // `identifyGuild` runs in a loop over every guild at startup. One throw
    // would abort the loop and take the rest of the startup with it.
    groupIdentifySpy.mockImplementationOnce(() => {
      throw new Error('posthog is down');
    });

    expect(() => analytics.identifyGuild({ id: 'g-1', name: 'x', memberCount: 1 })).not.toThrow();
  });

  test.each(['joined', 'removed'] as const)('records a %s event with the guild as the actor', (kind) => {
    analytics.recordGuildChange(kind, { id: 'g-1', name: 'Study Group', memberCount: 300 });

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: `bot_guild_${kind}`,
        properties: expect.objectContaining({ guild_name: 'Study Group', member_count: 300 }),
      }),
    );
  });
});

describe('reportException', () => {
  test('sends the error under a stable fingerprint, which is what groups it', () => {
    const error = new Error('boom');

    analytics.reportException(error, 'discord:command-failed', {
      actor: { userId: 'u-1', guildId: 'g-1' },
      properties: { command: 'search' },
    });

    expect(captureExceptionSpy).toHaveBeenCalledWith(
      error,
      expect.any(String),
      expect.objectContaining({
        $exception_fingerprint: 'discord:command-failed',
        error_source: 'discord:command-failed',
        error_type: 'Error',
        command: 'search',
      }),
    );
  });

  test('never sends a raw Discord snowflake as the distinct id', () => {
    // Same contract as `capture`: users are hashed. A raw snowflake reaching a
    // third party is a privacy incident, not a bug.
    analytics.reportException(new Error('boom'), 'src', { actor: { userId: 'user-snowflake-123', guildId: null } });

    expect(captureExceptionSpy.mock.calls[0][1]).not.toBe('user-snowflake-123');
  });

  test('attributes an error with no actor to the bot process, without a person profile', () => {
    analytics.reportException(new Error('boom'), 'discord:startup-failed');

    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      'discord-bot',
      expect.objectContaining({ $process_person_profile: false }),
    );
  });

  test('marks a DM error as such, since a null guild is meaningful', () => {
    analytics.reportException(new Error('boom'), 'src', { actor: { userId: 'u-1', guildId: null } });

    expect(captureExceptionSpy.mock.calls[0][2]).toMatchObject({ in_dm: true, $process_person_profile: true });
  });

  test('reporting a failure never becomes a second failure', () => {
    // This runs inside the catch block of a command that already failed.
    // Throwing here would replace a handled error with an unhandled one.
    captureExceptionSpy.mockImplementationOnce(() => {
      throw new Error('posthog is down');
    });

    expect(() => analytics.reportException(new Error('boom'), 'src')).not.toThrow();
  });
});

describe('reportFatal', () => {
  test('reports and then flushes, in that order, because the process is about to exit', async () => {
    const order: string[] = [];
    captureExceptionSpy.mockImplementationOnce(() => order.push('report'));
    shutdownSpy.mockImplementationOnce(async () => {
      order.push('flush');
    });

    await analytics.reportFatal(new Error('boom'), 'discord:uncaught-exception');

    expect(order).toEqual(['report', 'flush']);
  });

  test('wraps a non-Error rejection reason, so the report carries a stack', () => {
    // `unhandledRejection` hands over whatever was rejected -- often a string
    // or a plain object, which PostHog error tracking cannot group.
    analytics.reportFatal('just a string', 'discord:unhandled-rejection');

    expect(captureExceptionSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((captureExceptionSpy.mock.calls[0][0] as Error).message).toBe('just a string');
  });

  test('serializes a non-Error, non-string reason rather than reporting [object Object]', async () => {
    await analytics.reportFatal({ code: 'ECONNRESET' }, 'discord:unhandled-rejection');

    expect((captureExceptionSpy.mock.calls[0][0] as Error).message).toContain('ECONNRESET');
  });

  test('marks the report as fatal, which is what separates it from a handled error', () => {
    analytics.reportFatal(new Error('boom'), 'src');

    expect(captureExceptionSpy.mock.calls[0][2]).toMatchObject({ fatal: true });
  });
});

describe('shutdownAnalytics', () => {
  test('flushes with a bounded timeout, so a dying process cannot hang on it', async () => {
    await analytics.shutdownAnalytics();

    expect(shutdownSpy).toHaveBeenCalledWith(5000);
  });

  test('a failed flush does not stop the shutdown that is waiting on it', async () => {
    // This is awaited on the SIGTERM path. A rejection here would leave the
    // container to be killed rather than exiting cleanly.
    shutdownSpy.mockRejectedValueOnce(new Error('network down'));

    await expect(analytics.shutdownAnalytics()).resolves.toBeUndefined();
  });
});
