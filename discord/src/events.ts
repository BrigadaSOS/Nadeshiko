import type { AutocompleteInteraction, Interaction, Guild } from 'discord.js';
import { identifyGuild, recordGuildChange, reportException } from './analytics';
import { traceCommand, traceOperation } from './instrumentation';
import { searchMediaCache } from './mediaCache';
import { getMediaName } from './embeds';
import { createLogger } from './logger';
import type { Command } from './commands';

const log = createLogger('events');

/**
 * The gateway event handlers, lifted out of `bot.ts`.
 *
 * `bot.ts` calls `main()` at import and is a composition root -- it constructs
 * a real Discord client, opens a socket and installs process signal handlers,
 * so importing it in a test starts a bot. That made the routing decisions in
 * here permanently untestable while being the code most worth testing: which
 * interactions are dispatched, which are dropped, and -- the one that actually
 * matters to a user -- how a command that threw still produces a reply.
 *
 * Nothing here constructs anything. The client is passed in, so these are
 * ordinary functions over ordinary arguments.
 */

/** Discord truncates an autocomplete choice name at 100 characters. */
const AUTOCOMPLETE_NAME_LIMIT = 100;

/** The option name that offers media suggestions, shared by /search and /random. */
const MEDIA_OPTION = 'media';

async function respondWithMediaSuggestions(interaction: AutocompleteInteraction, query: string): Promise<void> {
  const results = await searchMediaCache(query);
  await interaction.respond(
    results.map((m) => ({
      name: getMediaName(m).slice(0, AUTOCOMPLETE_NAME_LIMIT),
      value: m.publicId,
    })),
  );
}

/**
 * The `interactionCreate` handler.
 *
 * Takes the command table rather than reaching for a module-level one, so a
 * test can hand it a single fake command instead of the real registry.
 */
export function createInteractionHandler(commands: { get(name: string): Command | undefined }) {
  return async function handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== MEDIA_OPTION) return;

      // Autocomplete has a hard three-second budget and no way to report a
      // failure to the user -- Discord simply shows no suggestions. A throw
      // here would surface as an unhandled rejection instead, which on Node 20+
      // takes the process with it.
      await traceOperation(
        'autocomplete',
        MEDIA_OPTION,
        { userId: interaction.user.id, guildId: interaction.guildId },
        () => respondWithMediaSuggestions(interaction, focused.value),
      ).catch((error) => {
        log.error({ err: error }, 'Media autocomplete failed');
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // A command Discord still has registered but this build no longer ships --
    // the normal state for the minutes between a deploy and a re-register.
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await traceCommand(interaction.commandName, interaction, () => command.execute(interaction));
    } catch (error) {
      log.error({ err: error, command: interaction.commandName }, 'Error executing command');
      // The user just got "something went wrong", so somebody had better be able
      // to say what. `recordInteraction` counts that this errored but carries no
      // stack, and the log line has the stack but no grouping -- this is the one
      // that turns "a command is failing" into an issue with a first-seen.
      reportException(error, 'discord:command-failed', {
        actor: { userId: interaction.user.id, guildId: interaction.guildId },
        properties: { command: interaction.commandName },
      });
      const content = 'Something went wrong executing this command.';
      // Which method is valid depends on what the command managed to do before
      // it threw: replying twice is a 40060 from Discord, and following up on
      // an interaction that was never acknowledged is a 404. Either way the
      // user would be left with nothing, so both are also best-effort.
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  };
}

/** The `guildCreate` handler: the bot was added to a server. */
export function handleGuildCreate(guild: Pick<Guild, 'id' | 'name' | 'memberCount'>): void {
  const info = { id: guild.id, name: guild.name, memberCount: guild.memberCount };
  identifyGuild(info);
  recordGuildChange('joined', info);
  log.info({ guildId: guild.id, name: guild.name }, 'Added to a server');
}

/** The `guildDelete` handler: the bot was removed from a server. */
export function handleGuildDelete(guild: { id: string; name?: string | null; memberCount?: number | null }): void {
  // `guild` is partial on removal when it was never cached, so the name and
  // member count can be missing here. The name was already recorded on join and
  // stored as a PostHog group property, so the roster keeps it either way.
  const info = { id: guild.id, name: guild.name ?? 'unknown', memberCount: guild.memberCount ?? 0 };
  recordGuildChange('removed', info);
  log.info({ guildId: guild.id, name: info.name }, 'Removed from a server');
}
