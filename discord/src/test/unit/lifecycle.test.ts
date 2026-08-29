import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * Process and gateway lifecycle.
 *
 * Every one of these runs only when something is ending -- a deploy, a crash, a
 * SIGTERM -- which is precisely why it is worth pinning: none of it executes in
 * development, so a break is not noticed until the morning it is needed, and by
 * then the thing it would have told you is gone.
 *
 * The two properties that carry the weight are both ORDER:
 *
 * - Shutdown flushes analytics BEFORE telemetry. PostHog's batch is the one
 *   that dies whole if the process exits first, and a deploy is exactly when
 *   the last few minutes of events matter most.
 * - The fatal handler exits whatever happens, on a deadline. Waiting on an OTLP
 *   flush during the kind of failure that produces an uncaught exception can
 *   hang forever -- with the health server still listening, so the container
 *   goes on looking healthy while the process is past reasoning about anything.
 */
const restPut = vi.fn().mockResolvedValue([]);
vi.mock('discord.js', () => ({
  REST: class {
    setToken() {
      return this;
    }
    put = restPut;
  },
  Routes: {
    applicationCommands: (appId: string) => `/applications/${appId}/commands`,
    applicationGuildCommands: (appId: string, guildId: string) => `/applications/${appId}/guilds/${guildId}/commands`,
  },
}));

const analytics = {
  bindGuilds: vi.fn(),
  bindGuildMembership: vi.fn(),
  identifyGuild: vi.fn(),
  reportFatal: vi.fn().mockResolvedValue(undefined),
  shutdownAnalytics: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../analytics', () => ({
  bindGuilds: (...a: unknown[]) => analytics.bindGuilds(...a),
  bindGuildMembership: (...a: unknown[]) => analytics.bindGuildMembership(...a),
  identifyGuild: (...a: unknown[]) => analytics.identifyGuild(...a),
  reportFatal: (...a: unknown[]) => analytics.reportFatal(...a),
  shutdownAnalytics: (...a: unknown[]) => analytics.shutdownAnalytics(...a),
}));

const shutdownTelemetry = vi.fn().mockResolvedValue(undefined);
vi.mock('../../telemetry', () => ({ shutdownTelemetry: () => shutdownTelemetry() }));

vi.mock('../../config', () => ({
  BOT_CONFIG: { token: 'token.part.part', frontendUrl: 'https://nadeshiko.co' },
  getApplicationId: () => 'app-1',
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, fatal: () => {} }),
}));

import {
  FATAL_REPORT_TIMEOUT_MS,
  createFatalHandler,
  createReadyHandler,
  createShutdown,
  registerCommands,
  reportStartupFailure,
} from '../../lifecycle';

/** A command as `allCommands` holds it. */
function command(name: string) {
  return { data: { name, toJSON: () => ({ name }) }, execute: vi.fn() } as never;
}

/** A ready client whose cache holds `guilds`. */
function readyClient(guilds: { id: string; name: string; memberCount: number }[]) {
  return {
    user: { id: 'bot-1', tag: 'Nadeshiko#0001' },
    guilds: {
      cache: {
        size: guilds.length,
        values: () => guilds[Symbol.iterator](),
        map: <T>(fn: (g: (typeof guilds)[number]) => T) => guilds.map(fn),
        has: (id: string) => guilds.some((g) => g.id === id),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  restPut.mockResolvedValue([]);
  analytics.reportFatal.mockResolvedValue(undefined);
  analytics.shutdownAnalytics.mockResolvedValue(undefined);
  shutdownTelemetry.mockResolvedValue(undefined);
});

describe('registerCommands', () => {
  test('registers globally when no guild is named', async () => {
    await registerCommands([command('search'), command('random')], undefined);

    expect(restPut).toHaveBeenCalledWith('/applications/app-1/commands', {
      body: [{ name: 'search' }, { name: 'random' }],
    });
  });

  test('registers to one guild when one is named', async () => {
    // A guild registration appears instantly and a global one takes up to an
    // hour, which is the entire reason `DISCORD_GUILD_ID` exists.
    await registerCommands([command('search')], 'guild-9');

    expect(restPut).toHaveBeenCalledWith('/applications/app-1/guilds/guild-9/commands', { body: [{ name: 'search' }] });
  });

  test('an empty guild id is not a guild registration', async () => {
    // An unset env var arrives as `''`, and taking that as a guild id publishes
    // the whole command set to a server called "".
    await registerCommands([command('search')], '');

    expect(restPut).toHaveBeenCalledWith('/applications/app-1/commands', expect.anything());
  });

  test('sends the serialized command definitions, not the builders', async () => {
    await registerCommands([command('search')], undefined);

    expect(restPut.mock.calls[0][1].body).toEqual([{ name: 'search' }]);
  });

  test('a refused registration propagates, so startup fails loudly', async () => {
    // Silently carrying on would leave the bot running with whatever command
    // set Discord had before -- which looks fine until somebody uses a new one.
    restPut.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(registerCommands([command('search')], undefined)).rejects.toThrow('401 Unauthorized');
  });
});

describe('the ready handler', () => {
  const guilds = [
    { id: 'g-1', name: 'Study Group', memberCount: 300 },
    { id: 'g-2', name: 'Anime Club', memberCount: 50 },
  ];

  test('binds the guild cache to the gauges', () => {
    createReadyHandler('123')(readyClient(guilds) as never);

    expect(analytics.bindGuilds).toHaveBeenCalledTimes(1);
    expect(analytics.bindGuilds.mock.calls[0][0]()).toEqual(guilds);
  });

  test('the bound reader reflects the cache as it is at collection time', () => {
    // This is why they are observable gauges rather than counters: the client's
    // cache is the truth, and it survives a restart.
    const live = [...guilds];
    const client = readyClient(live);
    createReadyHandler('123')(client as never);
    const read = analytics.bindGuilds.mock.calls[0][0];

    live.pop();

    expect(read()).toHaveLength(1);
  });

  test('binds a membership predicate that answers for the cached guilds', () => {
    // The guard that keeps `discord.guild.interactions` bounded now that
    // commands are user-installable and fire in servers the bot is not in.
    createReadyHandler('123')(readyClient(guilds) as never);
    const isInGuild = analytics.bindGuildMembership.mock.calls[0][0];

    expect(isInGuild('g-1')).toBe(true);
    expect(isInGuild('g-never')).toBe(false);
  });

  test('names EVERY server, not only the ones that join later', () => {
    // The bot was already in servers before any of this existed, and naming
    // groups only at join time would leave those permanently anonymous.
    createReadyHandler('123')(readyClient(guilds) as never);

    expect(analytics.identifyGuild).toHaveBeenCalledTimes(2);
    expect(analytics.identifyGuild).toHaveBeenCalledWith(guilds[0]);
    expect(analytics.identifyGuild).toHaveBeenCalledWith(guilds[1]);
  });

  test('survives a ready with no servers at all', () => {
    // A freshly created bot, and the state a token rotation leaves behind.
    expect(() => createReadyHandler('123')(readyClient([]) as never)).not.toThrow();
    expect(analytics.identifyGuild).not.toHaveBeenCalled();
  });
});

describe('shutdown', () => {
  function targets() {
    return {
      healthServer: { close: vi.fn() },
      client: { destroy: vi.fn() },
      exit: vi.fn(),
    };
  }

  test('stops answering the health probe and drops the gateway connection', async () => {
    const t = targets();

    await createShutdown(t)();

    expect(t.healthServer.close).toHaveBeenCalled();
    expect(t.client.destroy).toHaveBeenCalled();
  });

  test('flushes analytics BEFORE telemetry', async () => {
    // PostHog's flush is the one that loses a whole batch if the process exits
    // first, and a deploy is exactly when the last few minutes matter most.
    const order: string[] = [];
    analytics.shutdownAnalytics.mockImplementation(async () => void order.push('analytics'));
    shutdownTelemetry.mockImplementation(async () => void order.push('telemetry'));

    await createShutdown(targets())();

    expect(order).toEqual(['analytics', 'telemetry']);
  });

  test('closes the health probe before the gateway, so the container leaves rotation first', async () => {
    const order: string[] = [];
    const t = targets();
    t.healthServer.close.mockImplementation(() => order.push('health'));
    t.client.destroy.mockImplementation(() => order.push('client'));

    await createShutdown(t)();

    expect(order).toEqual(['health', 'client']);
  });

  test('exits cleanly once both flushes are done', async () => {
    const t = targets();

    await createShutdown(t)();

    expect(t.exit).toHaveBeenCalledWith(0);
  });

  test('exits only AFTER the flushes, not alongside them', async () => {
    const order: string[] = [];
    analytics.shutdownAnalytics.mockImplementation(async () => void order.push('analytics'));
    shutdownTelemetry.mockImplementation(async () => void order.push('telemetry'));
    const t = targets();
    t.exit.mockImplementation(() => order.push('exit'));

    await createShutdown(t)();

    expect(order).toEqual(['analytics', 'telemetry', 'exit']);
  });
});

describe('the fatal handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test('reports the cause before exiting', async () => {
    // The whole point: without a handler the process died with no log line, no
    // flush and no report, and the alert fired with nothing to explain it.
    const exit = vi.fn();
    const error = new Error('boom');

    createFatalHandler(exit)(error, 'discord:uncaught-exception');
    await vi.runAllTimersAsync();

    expect(analytics.reportFatal).toHaveBeenCalledWith(error, 'discord:uncaught-exception');
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('still exits when the report itself fails', async () => {
    // A bot that hangs on a failed report is strictly worse than one that
    // crashes: the health server is still listening.
    const exit = vi.fn();
    analytics.reportFatal.mockRejectedValue(new Error('posthog down'));

    createFatalHandler(exit)(new Error('boom'), 'src');
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledWith(1);
  });

  test('still exits when the telemetry flush fails', async () => {
    const exit = vi.fn();
    shutdownTelemetry.mockRejectedValue(new Error('otlp down'));

    createFatalHandler(exit)(new Error('boom'), 'src');
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledWith(1);
  });

  test('exits on the deadline when the flush never resolves at all', async () => {
    // The case the deadline exists for: an OTLP endpoint that, during the kind
    // of failure that produces an uncaught exception, is a fair candidate for
    // the thing that just broke.
    const exit = vi.fn();
    shutdownTelemetry.mockReturnValue(new Promise(() => {}));

    createFatalHandler(exit)(new Error('boom'), 'src');
    await vi.advanceTimersByTimeAsync(FATAL_REPORT_TIMEOUT_MS);

    expect(exit).toHaveBeenCalledWith(1);
  });

  test('does not wait the full deadline when the report was quick', async () => {
    // Report if it can be done quickly, exit regardless -- the timer is a
    // ceiling, not a delay.
    const exit = vi.fn();

    createFatalHandler(exit)(new Error('boom'), 'src');
    await vi.advanceTimersByTimeAsync(0);

    expect(exit).toHaveBeenCalledWith(1);
  });

  test('the deadline is cleared once the report has landed', async () => {
    // Otherwise a process that reported and exited cleanly is held open by a
    // pending timer that was deliberately not `unref`ed.
    const exit = vi.fn();

    createFatalHandler(exit)(new Error('boom'), 'src');
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterReport = exit.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FATAL_REPORT_TIMEOUT_MS * 2);

    expect(exit.mock.calls.length).toBe(callsAfterReport);
  });

  test('reports a non-Error reason, which is what a rejection usually carries', async () => {
    const exit = vi.fn();

    createFatalHandler(exit)('just a string', 'discord:unhandled-rejection');
    await vi.runAllTimersAsync();

    expect(analytics.reportFatal).toHaveBeenCalledWith('just a string', 'discord:unhandled-rejection');
  });
});

describe('a failure during startup', () => {
  test('is reported before the process gives up', async () => {
    // These are the ones most likely to be lost: nothing has been flushed yet,
    // so without the awaited report the batch dies with the explanation in it.
    const exit = vi.fn();
    const error = new Error('missing DISCORD_BOT_TOKEN');

    await reportStartupFailure(error, exit);

    expect(analytics.reportFatal).toHaveBeenCalledWith(error, 'discord:startup-failed');
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('reports before exiting, not after', async () => {
    const order: string[] = [];
    analytics.reportFatal.mockImplementation(async () => void order.push('report'));
    const exit = vi.fn(() => void order.push('exit'));

    await reportStartupFailure(new Error('boom'), exit);

    expect(order).toEqual(['report', 'exit']);
  });
});
