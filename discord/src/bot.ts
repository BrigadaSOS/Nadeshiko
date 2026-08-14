import { shutdownTelemetry } from './telemetry';
import { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, Collection, Events } from 'discord.js';
import { BOT_CONFIG, getApplicationId, validateConfig } from './config';
import { createLogger } from './logger';
import {
  bindGuilds,
  identifyGuild,
  recordGuildChange,
  recordRateLimit,
  reportException,
  reportFatal,
  shutdownAnalytics,
} from './analytics';
import { traceCommand, traceOperation } from './instrumentation';
import { startHealthServer } from './health';
import { initSdk } from './api';
import { initSettings } from './settings';
import { allCommands, type Command } from './commands';
import { searchMediaCache } from './mediaCache';
import { getMediaName } from './embeds';

const log = createLogger('bot');

/**
 * How long a dying process may spend explaining itself before it is killed
 * anyway. Sized to just clear the 5s cap `shutdownAnalytics` puts on PostHog's
 * flush -- that flush is the report worth waiting for -- with a little room for
 * the OTLP one behind it, and nothing beyond that.
 */
const FATAL_REPORT_TIMEOUT_MS = 8000;

/**
 * Everything the bot says goes out over an interaction token, which is exempt
 * from the channel permission checks a message-sending bot would need. So it
 * asks for neither View Channel nor Send Messages, and on the Guilds intent
 * alone (below) it could not read message history even if it were granted.
 * What is left is the three the bot genuinely spends: the commands themselves,
 * the custom emoji on its buttons -- the one permission Discord does enforce on
 * interaction responses -- and the clip uploads.
 */
const INVITE_PERMISSIONS = (
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.AttachFiles
).toString();

const commands = new Collection<string, Command>();
for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_CONFIG.token);
  const commandData = allCommands.map((cmd) => cmd.data.toJSON());
  const appId = getApplicationId();
  const guildId = process.env.DISCORD_GUILD_ID;

  if (guildId) {
    const data = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commandData });
    log.info({ count: (data as unknown[]).length, guildId }, 'Registered guild commands');
  } else {
    const data = await rest.put(Routes.applicationCommands(appId), { body: commandData });
    log.info({ count: (data as unknown[]).length }, 'Registered global commands');
  }
}

async function main() {
  validateConfig();

  initSdk();
  initSettings();

  log.info({ apiBaseUrl: BOT_CONFIG.apiBaseUrl }, 'Starting bot');

  if (process.env.REGISTER_COMMANDS === 'true') {
    await registerCommands();
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    // The guild gauges read the client's cache at collection time rather than
    // tracking joins and leaves themselves, so they survive restarts.
    bindGuilds(() =>
      readyClient.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      })),
    );

    // Every guild, not only ones that join later: the bot was already in
    // servers before any of this existed, and naming groups only at join time
    // would leave those permanently anonymous in PostHog.
    for (const guild of readyClient.guilds.cache.values()) {
      identifyGuild({ id: guild.id, name: guild.name, memberCount: guild.memberCount });
    }

    log.info({ tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size }, 'Bot online');
    log.info(
      {
        url: `https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
      },
      'Invite URL',
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'media') {
        await traceOperation(
          'autocomplete',
          'media',
          { userId: interaction.user.id, guildId: interaction.guildId },
          async () => {
            const results = await searchMediaCache(focused.value);
            await interaction.respond(
              results.map((m) => ({
                name: getMediaName(m).slice(0, 100),
                value: m.publicId,
              })),
            );
          },
        ).catch((error) => {
          log.error({ err: error }, 'Media autocomplete failed');
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

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
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    const info = { id: guild.id, name: guild.name, memberCount: guild.memberCount };
    identifyGuild(info);
    recordGuildChange('joined', info);
    log.info({ guildId: guild.id, name: guild.name, guilds: client.guilds.cache.size }, 'Added to a server');
  });

  client.on(Events.GuildDelete, (guild) => {
    // `guild` is partial on removal when it was never cached, so the name can
    // be missing here. It was already recorded on join and stored as a PostHog
    // group property, so the roster keeps the name either way.
    const info = { id: guild.id, name: guild.name ?? 'unknown', memberCount: guild.memberCount ?? 0 };
    recordGuildChange('removed', info);
    log.info({ guildId: guild.id, name: info.name, guilds: client.guilds.cache.size }, 'Removed from a server');
  });

  client.rest.on('rateLimited', (info) => {
    recordRateLimit(info.global);
    log.warn(
      { route: info.route, limit: info.limit, timeout: info.timeToReset, global: info.global },
      'Rate limited by Discord',
    );
  });

  await client.login(BOT_CONFIG.token);

  const healthServer = startHealthServer(Number(process.env.HEALTH_PORT) || 3000);

  const shutdown = async () => {
    log.info('Shutting down');
    healthServer.close();
    client.destroy();
    // Analytics before telemetry: PostHog's flush is the one that loses a whole
    // batch if the process exits first, and deploys are exactly when the last
    // few minutes of events matter most.
    await shutdownAnalytics();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  /**
   * The bot had no handler for either of these, and the default behaviour on
   * Node 20+ is to terminate on an unhandled rejection. So a rejected promise
   * anywhere off the interaction path -- a gateway reconnect, a timer, an
   * `await` nobody caught -- killed the process with no log line, no flush, and
   * no report: `NadeshikoDiscordBotDown` would fire in Grafana with nothing
   * anywhere to say what had happened.
   *
   * Both still exit. This is not an attempt to keep running through a fault the
   * process cannot reason about -- Kamal restarts the container, and a bot that
   * limps on after an unknown failure is worse than one that comes back clean.
   * The only thing being bought is that the cause survives the exit.
   */
  const die = (error: unknown, source: string) => {
    log.fatal({ err: error }, source);

    /**
     * A hard deadline on the whole reporting path, because installing these
     * handlers at all is a trade and this is the side of it that can bite.
     *
     * Without a handler, an uncaught fault killed the process instantly and
     * Kamal restarted it. With one, the exit waits on a flush -- and
     * `shutdownTelemetry` carries no timeout of its own while flushing to an
     * OTLP endpoint that, during the kind of failure that produces an uncaught
     * exception, is a fair candidate for the thing that just broke. A bot that
     * hangs on that is strictly worse than one that crashes: the health server
     * is still listening, so the container goes on looking healthy while the
     * process is past reasoning about anything.
     *
     * So: report if it can be done quickly, exit regardless. The timer is
     * deliberately not `unref`ed -- keeping the loop alive until it fires is
     * the point.
     */
    const deadline = setTimeout(() => process.exit(1), FATAL_REPORT_TIMEOUT_MS);

    void reportFatal(error, source)
      .catch(() => {})
      .then(() => shutdownTelemetry())
      .catch(() => {})
      .finally(() => {
        clearTimeout(deadline);
        process.exit(1);
      });
  };

  process.on('uncaughtException', (error) => die(error, 'discord:uncaught-exception'));
  process.on('unhandledRejection', (reason) => die(reason, 'discord:unhandled-rejection'));
}

main().catch(async (err) => {
  log.fatal({ err }, 'Fatal error');
  // Startup failures are the ones worth seeing most and the ones most likely to
  // be lost: nothing has been flushed yet, so without this the batch dies here.
  await reportFatal(err, 'discord:startup-failed');
  process.exit(1);
});
