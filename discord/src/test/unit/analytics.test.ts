import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The privacy contract on the PostHog sink.
 *
 * `analytics.ts` states it plainly: users are hashed, servers are not, and an
 * unsalted deployment gets no PostHog at all rather than quietly getting the
 * unsafe version. Every one of those is a module-level decision made once at
 * import time from the environment, which is exactly the kind of thing that
 * regresses without anyone noticing -- a raw Discord snowflake reaching a third
 * party is a privacy incident, not a bug report, and nothing about the bot's
 * behaviour would look different.
 */

const captureSpy = vi.fn();
const constructorSpy = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      constructorSpy(...args);
    }
    capture = captureSpy;
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

const USER = 'user-snowflake-123';
const GUILD = 'guild-snowflake-456';

async function loadAnalytics(env: { key?: string; salt?: string }) {
  vi.resetModules();
  captureSpy.mockClear();
  constructorSpy.mockClear();

  if (env.key) vi.stubEnv('POSTHOG_PROJECT_API_KEY', env.key);
  else vi.stubEnv('POSTHOG_PROJECT_API_KEY', '');
  if (env.salt) vi.stubEnv('DISCORD_ANALYTICS_SALT', env.salt);
  else vi.stubEnv('DISCORD_ANALYTICS_SALT', '');

  return import('../../analytics');
}

function searchArgs(actor: { userId: string; guildId: string | null }) {
  return {
    actor,
    mode: 'query' as const,
    resultCount: 3,
    queryLength: 8,
    mediaFiltered: false,
    source: 'command',
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('when the salt is missing', () => {
  test('PostHog is never constructed, so nothing can be sent', async () => {
    await loadAnalytics({ key: 'phc_test' });

    expect(constructorSpy).not.toHaveBeenCalled();
  });

  test('recording an event is a silent no-op rather than an error', async () => {
    const analytics = await loadAnalytics({ key: 'phc_test' });

    expect(() => analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }))).not.toThrow();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  test('the key alone is not enough -- the unsafe path is never the default', async () => {
    await loadAnalytics({ key: 'phc_test', salt: undefined });

    expect(constructorSpy).not.toHaveBeenCalled();
  });
});

describe('when key and salt are both set', () => {
  let analytics: typeof import('../../analytics');

  beforeEach(async () => {
    analytics = await loadAnalytics({ key: 'phc_test', salt: 'salt-a' });
  });

  test('constructs PostHog with geoip off, so the bot’s egress is not read as a user location', () => {
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy.mock.calls[0][1]).toMatchObject({ disableGeoip: true });
  });

  test('never sends the raw user id', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));

    const payload = captureSpy.mock.calls[0][0];
    expect(payload.distinctId).not.toBe(USER);
    expect(JSON.stringify(payload)).not.toContain(USER);
  });

  test('sends a 32-char hex pseudonym instead', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));

    expect(captureSpy.mock.calls[0][0].distinctId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('the pseudonym is stable, so the same person is one person', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));

    const [first, second] = captureSpy.mock.calls.map((c) => c[0].distinctId);
    expect(first).toBe(second);
  });

  test('different people get different pseudonyms', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));
    analytics.recordSearch(searchArgs({ userId: 'someone-else', guildId: GUILD }));

    const [first, second] = captureSpy.mock.calls.map((c) => c[0].distinctId);
    expect(first).not.toBe(second);
  });

  test('the guild travels raw -- users are hashed, servers are not', () => {
    // The asymmetry is deliberate: a server is a venue, not a person, and the
    // raw id is what joins to the name set by identifyGuild.
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));

    expect(captureSpy.mock.calls[0][0].groups).toEqual({ guild: GUILD });
  });

  test('the guild id is not a property, only a group', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));

    const { properties } = captureSpy.mock.calls[0][0];
    expect(JSON.stringify(properties)).not.toContain(GUILD);
    expect(properties.in_dm).toBe(false);
  });

  test('a DM is marked as one and carries no group', () => {
    analytics.recordSearch(searchArgs({ userId: USER, guildId: null }));

    const payload = captureSpy.mock.calls[0][0];
    expect(payload.properties.in_dm).toBe(true);
    expect(payload.groups).toBeUndefined();
  });

  test('sends the query’s length and never the query itself', () => {
    analytics.recordSearch({ ...searchArgs({ userId: USER, guildId: GUILD }), queryLength: 12 });

    const { properties } = captureSpy.mock.calls[0][0];
    expect(properties.query_length).toBe(12);
    // Whatever else grows into this payload, it must stay a shape, not content.
    expect(Object.keys(properties)).not.toContain('query');
  });

  test('names an empty search differently from one with results', () => {
    analytics.recordSearch({ ...searchArgs({ userId: USER, guildId: GUILD }), resultCount: 0 });
    analytics.recordSearch({ ...searchArgs({ userId: USER, guildId: GUILD }), resultCount: 5 });

    expect(captureSpy.mock.calls[0][0].event).toBe('bot_search_empty');
    expect(captureSpy.mock.calls[1][0].event).toBe('bot_search_performed');
  });

  test('a failing sink never takes the interaction down with it', () => {
    captureSpy.mockImplementationOnce(() => {
      throw new Error('posthog is down');
    });

    expect(() => analytics.recordSearch(searchArgs({ userId: USER, guildId: GUILD }))).not.toThrow();
  });
});

describe('the salt actually salts', () => {
  test('the same user hashes differently under a different salt', async () => {
    const a = await loadAnalytics({ key: 'phc_test', salt: 'salt-a' });
    a.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));
    const underA = captureSpy.mock.calls[0][0].distinctId;

    const b = await loadAnalytics({ key: 'phc_test', salt: 'salt-b' });
    b.recordSearch(searchArgs({ userId: USER, guildId: GUILD }));
    const underB = captureSpy.mock.calls[0][0].distinctId;

    // If the salt were dropped from the hash input this would pass equality --
    // and a hash of a public snowflake is a lookup, not a disguise.
    expect(underA).not.toBe(underB);
  });
});
