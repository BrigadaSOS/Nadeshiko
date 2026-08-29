import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * Every user-visible path through the bot goes through one of these wrappers,
 * and the contract they hold is asymmetric in a way that is easy to get wrong:
 *
 * - a command's throw must PROPAGATE, because `bot.ts` catches it to tell the
 *   user something went wrong;
 * - a component's or modal's throw must NOT, because those handlers are async
 *   callbacks on an EventEmitter where a throw is an unhandled rejection that
 *   Node terminates the process over;
 * - and in both cases the interaction must still be recorded, as an error.
 *
 * Swapping either half is silent. Nothing about a successful interaction looks
 * different, and the failure only shows up as a dead button or a dead bot.
 */
const recordInteraction = vi.fn();
vi.mock('../../analytics', () => ({
  recordInteraction: (...args: unknown[]) => recordInteraction(...args),
}));

const spanEvents: { method: string; arg?: unknown }[] = [];
const startActiveSpan = vi.fn(async (_name: string, _opts: unknown, fn: (span: unknown) => Promise<void>) =>
  fn({
    setStatus: (s: unknown) => spanEvents.push({ method: 'setStatus', arg: s }),
    recordException: (e: unknown) => spanEvents.push({ method: 'recordException', arg: e }),
    end: () => spanEvents.push({ method: 'end' }),
  }),
);

vi.mock('../../telemetry', () => ({
  getTracer: () => ({ startActiveSpan }),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

import { traceCommand, traceComponent, traceModal, traceOperation, getActiveTraceId } from '../../instrumentation';

const interaction = {
  user: { id: 'user-1' },
  guildId: 'guild-1' as string | null,
  channelId: 'channel-1',
  commandName: 'search',
  customId: 'next_page',
  componentType: 2,
};

/** The wrappers take real discord.js interaction types; the double is structural. */
const asInteraction = (i: typeof interaction) => i as never;

/** The span name and attributes the last traced call opened with. */
function lastSpan() {
  const [name, options] = startActiveSpan.mock.calls.at(-1) ?? [];
  return { name, attributes: (options as { attributes: Record<string, string> })?.attributes };
}

beforeEach(() => {
  recordInteraction.mockReset();
  startActiveSpan.mockClear();
  spanEvents.length = 0;
});

describe('traceCommand', () => {
  test('records the interaction as a command that succeeded', async () => {
    await traceCommand('search', asInteraction(interaction), async () => {});

    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command',
        name: 'search',
        surface: 'search',
        actor: { userId: 'user-1', guildId: 'guild-1' },
        error: undefined,
      }),
    );
  });

  test('names the span after the kind and the command', async () => {
    await traceCommand('search', asInteraction(interaction), async () => {});

    expect(lastSpan().name).toBe('command search');
  });

  test('carries the identifiers on the span, where they are cheap', async () => {
    // Identifiers belong on spans (sampled, short-lived) and never as metric
    // attributes -- the asymmetry analytics.ts exists to maintain.
    await traceCommand('search', asInteraction(interaction), async () => {});

    expect(lastSpan().attributes).toMatchObject({
      'discord.user.id': 'user-1',
      'discord.guild.id': 'guild-1',
      'discord.channel.id': 'channel-1',
    });
  });

  test('labels a DM rather than leaving the guild attribute unset', async () => {
    await traceCommand('search', asInteraction({ ...interaction, guildId: null }), async () => {});

    expect(lastSpan().attributes).toMatchObject({ 'discord.guild.id': 'dm' });
  });

  test('rethrows, because bot.ts is what tells the user it failed', async () => {
    const failure = new Error('boom');

    await expect(traceCommand('search', asInteraction(interaction), async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });

  test('still records the interaction when the command threw, tagged with the error', async () => {
    const failure = new Error('boom');

    await traceCommand('search', asInteraction(interaction), async () => Promise.reject(failure)).catch(() => {});

    expect(recordInteraction).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });

  test('marks the span as errored and records the exception on it', async () => {
    await traceCommand('search', asInteraction(interaction), async () => Promise.reject(new Error('boom'))).catch(
      () => {},
    );

    expect(spanEvents.map((e) => e.method)).toEqual(['setStatus', 'recordException', 'end']);
  });

  test('ends the span even when the handler threw, so it is not left open', async () => {
    await traceCommand('search', asInteraction(interaction), async () => Promise.reject(new Error('boom'))).catch(
      () => {},
    );

    expect(spanEvents.at(-1)?.method).toBe('end');
  });

  test('wraps a thrown non-Error before recording it, since recordException needs one', async () => {
    await traceCommand('search', asInteraction(interaction), async () => Promise.reject('just a string')).catch(
      () => {},
    );

    const recorded = spanEvents.find((e) => e.method === 'recordException')?.arg;
    expect(recorded).toBeInstanceOf(Error);
  });

  test('measures how long the handler took', async () => {
    await traceCommand('search', asInteraction(interaction), async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    expect(recordInteraction.mock.calls[0][0].durationSeconds).toBeGreaterThan(0.005);
  });
});

describe('traceComponent', () => {
  test('runs the wrapped handler with the interaction', async () => {
    const handler = vi.fn(async () => {});

    await traceComponent('search', handler)(asInteraction(interaction));

    expect(handler).toHaveBeenCalledWith(interaction);
  });

  test('names the interaction by its custom id, giving per-button granularity', async () => {
    // This is why the wrapper sits on the collector rather than on each branch:
    // a button added later is instrumented without anyone remembering to.
    await traceComponent('search', async () => {})(asInteraction(interaction));

    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'component', name: 'next_page', surface: 'search' }),
    );
  });

  test('swallows a throw, because an EventEmitter callback that rejects kills the process', async () => {
    const swallowed = traceComponent('search', async () => Promise.reject(new Error('boom')));

    await expect(swallowed(asInteraction(interaction))).resolves.toBeUndefined();
  });

  test('records the failure before swallowing it, so a dead button is visible', async () => {
    const failure = new Error('boom');

    await traceComponent('search', async () => Promise.reject(failure))(asInteraction(interaction));

    expect(recordInteraction).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });
});

describe('traceModal', () => {
  test('records a modal submission under its custom id', async () => {
    await traceModal('search', async () => {})(asInteraction(interaction));

    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'modal', name: 'next_page', surface: 'search' }),
    );
  });

  test('swallows a throw, for the same reason as traceComponent', async () => {
    const swallowed = traceModal('search', async () => Promise.reject(new Error('boom')));

    await expect(swallowed(asInteraction(interaction))).resolves.toBeUndefined();
  });

  test('still records the failed submission', async () => {
    await traceModal('search', async () => Promise.reject(new Error('boom')))(asInteraction(interaction));

    expect(recordInteraction).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }));
  });
});

describe('traceOperation', () => {
  test('records an operation that has no custom id to name it, such as autocomplete', async () => {
    await traceOperation('autocomplete', 'media', { userId: 'user-1', guildId: null }, async () => {});

    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'autocomplete', name: 'media', surface: 'media' }),
    );
  });

  test('propagates a throw, leaving the caller to decide what to do', async () => {
    const failure = new Error('boom');

    await expect(
      traceOperation('autocomplete', 'media', { userId: 'u', guildId: null }, async () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});

describe('getActiveTraceId', () => {
  test('is undefined outside a span, rather than throwing', async () => {
    // Error handlers append it to the user-facing message. Throwing while
    // building an error message would replace the error with a worse one.
    expect(getActiveTraceId()).toBeUndefined();
  });
});
