import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * The gateway routing, which until it was lifted out of `bot.ts` could not be
 * imported without starting a real bot.
 *
 * The error path is the reason this file exists. When a command throws, the
 * user is owed a reply, and which method produces one depends on how far the
 * command got before it failed: `reply` on an interaction that was already
 * deferred is a 40060, and `followUp` on one that was never acknowledged is a
 * 404. Getting it backwards leaves the user looking at "the application did not
 * respond" while the logs show the error was handled.
 */
const searchMediaCache = vi.fn();
vi.mock('../../mediaCache', () => ({ searchMediaCache: (...a: unknown[]) => searchMediaCache(...a) }));

const reportException = vi.fn();
const identifyGuild = vi.fn();
const recordGuildChange = vi.fn();
vi.mock('../../analytics', () => ({
  reportException: (...a: unknown[]) => reportException(...a),
  identifyGuild: (...a: unknown[]) => identifyGuild(...a),
  recordGuildChange: (...a: unknown[]) => recordGuildChange(...a),
}));

// Pass-throughs, not no-ops: a mock that dropped the handler would let every
// assertion below pass without the command ever running.
vi.mock('../../instrumentation', () => ({
  traceCommand: (_name: string, _i: unknown, fn: () => Promise<void>) => fn(),
  traceOperation: (_k: string, _n: string, _a: unknown, fn: () => Promise<void>) => fn(),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

import { createInteractionHandler, handleGuildCreate, handleGuildDelete } from '../../events';

/** A chat-input interaction whose reply methods are observable. */
function chatInput(commandName: string, state: { replied?: boolean; deferred?: boolean } = {}) {
  return {
    user: { id: 'user-1' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    commandName,
    replied: state.replied ?? false,
    deferred: state.deferred ?? false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

/** An autocomplete interaction focused on the named option. */
function autocomplete(optionName: string, value = 'osh') {
  return {
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: { getFocused: () => ({ name: optionName, value }) },
    respond: vi.fn().mockResolvedValue(undefined),
  };
}

/** A command table holding a single command. */
function tableWith(name: string, execute: () => Promise<void>) {
  return { get: (n: string) => (n === name ? ({ execute } as never) : undefined) };
}

beforeEach(() => {
  searchMediaCache.mockReset();
  searchMediaCache.mockResolvedValue([]);
  reportException.mockReset();
  identifyGuild.mockReset();
  recordGuildChange.mockReset();
});

describe('command dispatch', () => {
  test('runs the command Discord named', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const handler = createInteractionHandler(tableWith('search', execute));
    const interaction = chatInput('search');

    await handler(interaction as never);

    expect(execute).toHaveBeenCalledWith(interaction);
  });

  test('ignores a command this build does not ship', async () => {
    // The normal state for the minutes between a deploy and a re-register.
    // Replying with an error there would be noise, not information.
    const handler = createInteractionHandler(tableWith('search', vi.fn()));
    const interaction = chatInput('retired-command');

    await handler(interaction as never);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(reportException).not.toHaveBeenCalled();
  });

  test('ignores an interaction that is neither a command nor autocomplete', async () => {
    // Button and modal interactions are handled by their own collectors.
    const execute = vi.fn();
    const handler = createInteractionHandler(tableWith('search', execute));

    await handler({ isAutocomplete: () => false, isChatInputCommand: () => false } as never);

    expect(execute).not.toHaveBeenCalled();
  });
});

describe('when a command throws', () => {
  const boom = () => Promise.reject(new Error('boom'));

  test('replies to an interaction that had not answered yet', async () => {
    const handler = createInteractionHandler(tableWith('search', boom));
    const interaction = chatInput('search');

    await handler(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Something went wrong executing this command.',
      ephemeral: true,
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('follows up on one that had already deferred, which cannot be replied to twice', async () => {
    const handler = createInteractionHandler(tableWith('search', boom));
    const interaction = chatInput('search', { deferred: true });

    await handler(interaction as never);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('follows up on one that had already replied', async () => {
    const handler = createInteractionHandler(tableWith('search', boom));
    const interaction = chatInput('search', { replied: true });

    await handler(interaction as never);

    expect(interaction.followUp).toHaveBeenCalled();
  });

  test('answers ephemerally, so a failure is not broadcast to the channel', async () => {
    const handler = createInteractionHandler(tableWith('search', boom));
    const interaction = chatInput('search', { deferred: true });

    await handler(interaction as never);

    expect(interaction.followUp.mock.calls[0][0]).toMatchObject({ ephemeral: true });
  });

  test('reports the error with a stable fingerprint and the command name', async () => {
    // `recordInteraction` counts that this errored but carries no stack; the
    // log line has the stack but no grouping. This is the one that turns "a
    // command is failing" into an issue with a first-seen.
    const handler = createInteractionHandler(tableWith('search', boom));

    await handler(chatInput('search') as never);

    expect(reportException).toHaveBeenCalledWith(
      expect.any(Error),
      'discord:command-failed',
      expect.objectContaining({
        actor: { userId: 'user-1', guildId: 'guild-1' },
        properties: { command: 'search' },
      }),
    );
  });

  test('does not throw when even the apology fails to send', async () => {
    // The interaction token expires after three seconds; by the time a slow
    // command fails, replying can 404. Throwing here would turn a handled
    // command failure into an unhandled rejection that ends the process.
    const handler = createInteractionHandler(tableWith('search', boom));
    const interaction = chatInput('search');
    interaction.reply.mockRejectedValue(new Error('Unknown interaction'));

    await expect(handler(interaction as never)).resolves.toBeUndefined();
  });
});

describe('media autocomplete', () => {
  test('answers with the suggestions the cache returned', async () => {
    searchMediaCache.mockResolvedValue([
      { publicId: 'm-1', nameRomaji: 'Oshi no Ko', nameEn: 'Oshi no Ko', nameJa: '推しの子' },
    ]);
    const handler = createInteractionHandler(tableWith('search', vi.fn()));
    const interaction = autocomplete('media');

    await handler(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([{ name: 'Oshi no Ko', value: 'm-1' }]);
  });

  test('forwards what the user has typed so far', async () => {
    const handler = createInteractionHandler(tableWith('search', vi.fn()));

    await handler(autocomplete('media', 'spy') as never);

    expect(searchMediaCache).toHaveBeenCalledWith('spy');
  });

  test('truncates a name at Discord’s hundred-character choice limit', async () => {
    // Discord rejects the entire response if one choice name is too long, so a
    // single long title would blank the suggestions for every query matching it.
    searchMediaCache.mockResolvedValue([{ publicId: 'm-1', nameRomaji: 'x'.repeat(300) }]);
    const handler = createInteractionHandler(tableWith('search', vi.fn()));
    const interaction = autocomplete('media');

    await handler(interaction as never);

    expect(interaction.respond.mock.calls[0][0][0].name).toHaveLength(100);
  });

  test('ignores autocomplete on any other option', async () => {
    const handler = createInteractionHandler(tableWith('search', vi.fn()));
    const interaction = autocomplete('query');

    await handler(interaction as never);

    expect(searchMediaCache).not.toHaveBeenCalled();
    expect(interaction.respond).not.toHaveBeenCalled();
  });

  test('swallows a failure rather than letting it kill the process', async () => {
    // Autocomplete has no way to report an error to the user -- Discord just
    // shows nothing -- and an unhandled rejection on Node 20+ terminates.
    searchMediaCache.mockRejectedValue(new Error('backend down'));
    const handler = createInteractionHandler(tableWith('search', vi.fn()));

    await expect(handler(autocomplete('media') as never)).resolves.toBeUndefined();
  });

  test('never falls through to command dispatch', async () => {
    const execute = vi.fn();
    const handler = createInteractionHandler(tableWith('search', execute));

    await handler(autocomplete('media') as never);

    expect(execute).not.toHaveBeenCalled();
  });
});

describe('guild lifecycle handlers', () => {
  test('a join names the guild before recording it', async () => {
    // Order matters: `recordGuildChange` sends an event attributed to the
    // group, and a group that has not been identified shows as a bare id.
    const order: string[] = [];
    identifyGuild.mockImplementation(() => order.push('identify'));
    recordGuildChange.mockImplementation(() => order.push('record'));

    handleGuildCreate({ id: 'g-1', name: 'Study Group', memberCount: 300 } as never);

    expect(order).toEqual(['identify', 'record']);
    expect(recordGuildChange).toHaveBeenCalledWith('joined', { id: 'g-1', name: 'Study Group', memberCount: 300 });
  });

  test('a removal is recorded', () => {
    handleGuildDelete({ id: 'g-1', name: 'Study Group', memberCount: 300 });

    expect(recordGuildChange).toHaveBeenCalledWith('removed', { id: 'g-1', name: 'Study Group', memberCount: 300 });
  });

  test('a removal of a guild that was never cached still records, with placeholders', () => {
    // discord.js delivers a partial guild here. Reading `.name` off it yields
    // undefined, and an undefined group property overwrites the real name that
    // was stored on join.
    handleGuildDelete({ id: 'g-1' });

    expect(recordGuildChange).toHaveBeenCalledWith('removed', { id: 'g-1', name: 'unknown', memberCount: 0 });
  });

  test('a removal does not re-identify the guild, which would undo its stored name', () => {
    handleGuildDelete({ id: 'g-1' });

    expect(identifyGuild).not.toHaveBeenCalled();
  });
});
