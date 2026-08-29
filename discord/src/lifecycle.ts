import { REST, Routes } from 'discord.js';
import { BOT_CONFIG, getApplicationId } from './config';
import { bindGuilds, bindGuildMembership, identifyGuild, reportFatal, shutdownAnalytics } from './analytics';
import { shutdownTelemetry } from './telemetry';
import { createLogger } from './logger';
import { botGuildInstallUrl, botInstallUrl } from './links';
import type { Command } from './commands';

const log = createLogger('lifecycle');

/**
 * Process and gateway lifecycle, lifted out of `bot.ts` for the same reason the
 * event routing was: that file calls `main()` at import, so none of this could
 * be reached from a test while all of it decides something.
 *
 * What is decided here is what happens when things go wrong, which is exactly
 * the code that never runs in development and is therefore never noticed to be
 * broken until the morning it matters.
 */

/**
 * How long a dying process may spend explaining itself before it is killed
 * anyway. Sized to just clear the 5s cap `shutdownAnalytics` puts on PostHog's
 * flush -- that flush is the report worth waiting for -- with a little room for
 * the OTLP one behind it, and nothing beyond that.
 */
export const FATAL_REPORT_TIMEOUT_MS = 8000;

/** A guild as the metrics and PostHog group properties describe it. */
type GuildInfo = { id: string; name: string; memberCount: number };

/** The slice of a ready discord.js client this module reads. */
type ReadyClient = {
  user: { id: string; tag: string };
  guilds: {
    cache: {
      size: number;
      values(): Iterable<GuildInfo>;
      map<T>(fn: (g: GuildInfo) => T): T[];
      has(id: string): boolean;
    };
  };
};

/**
 * Registers the slash commands, to one guild or globally.
 *
 * A guild registration appears instantly and a global one takes up to an hour,
 * which is why `DISCORD_GUILD_ID` exists at all: it is the development path.
 * Picking the wrong one in production publishes the command set to a single
 * server and leaves every other one on whatever it had.
 */
export async function registerCommands(
  allCommands: readonly Command[],
  guildId: string | undefined = process.env.DISCORD_GUILD_ID,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(BOT_CONFIG.token);
  const commandData = allCommands.map((cmd) => cmd.data.toJSON());
  const appId = getApplicationId();

  if (guildId) {
    const data = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commandData });
    log.info({ count: (data as unknown[]).length, guildId }, 'Registered guild commands');
    return;
  }

  const data = await rest.put(Routes.applicationCommands(appId), { body: commandData });
  log.info({ count: (data as unknown[]).length }, 'Registered global commands');
}

/** The permissions an invite asks for, spelled by `bot.ts` and logged here. */
export type InvitePermissions = string;

/**
 * The `clientReady` handler: binds the guild gauges and names every server.
 */
export function createReadyHandler(invitePermissions: InvitePermissions) {
  return function onReady(readyClient: ReadyClient): void {
    // The guild gauges read the client's cache at collection time rather than
    // tracking joins and leaves themselves, so they survive restarts.
    bindGuilds(() =>
      readyClient.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      })),
    );
    bindGuildMembership((guildId) => readyClient.guilds.cache.has(guildId));

    // Every guild, not only ones that join later: the bot was already in
    // servers before any of this existed, and naming groups only at join time
    // would leave those permanently anonymous in PostHog.
    for (const guild of readyClient.guilds.cache.values()) {
      identifyGuild({ id: guild.id, name: guild.name, memberCount: guild.memberCount });
    }

    log.info({ tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size }, 'Bot online');
    log.info(
      {
        install: botInstallUrl(readyClient.user.id),
        guildInstall: botGuildInstallUrl(readyClient.user.id, invitePermissions),
      },
      'Install URLs',
    );
  };
}

/** What a clean shutdown has to take down, in the order it has to do it. */
type ShutdownTargets = {
  healthServer: { close(): unknown };
  client: { destroy(): unknown };
  exit?: (code: number) => void;
};

/**
 * The SIGINT/SIGTERM handler.
 *
 * The ORDER is the whole content: analytics before telemetry, because PostHog's
 * flush is the one that loses a whole batch if the process exits first, and a
 * deploy is exactly when the last few minutes of events matter most.
 */
export function createShutdown({ healthServer, client, exit = process.exit }: ShutdownTargets) {
  return async function shutdown(): Promise<void> {
    log.info('Shutting down');
    // Stop answering the health probe before the gateway connection goes, so
    // the orchestrator takes this container out of rotation rather than
    // routing to a bot that is already halfway gone.
    healthServer.close();
    client.destroy();
    await shutdownAnalytics();
    await shutdownTelemetry();
    exit(0);
  };
}

/**
 * The `uncaughtException` / `unhandledRejection` handler.
 *
 * The bot had no handler for either, and the default behaviour on Node 20+ is
 * to terminate on an unhandled rejection. So a rejected promise anywhere off
 * the interaction path -- a gateway reconnect, a timer, an `await` nobody
 * caught -- killed the process with no log line, no flush and no report:
 * `NadeshikoDiscordBotDown` would fire in Grafana with nothing anywhere to say
 * what had happened.
 *
 * It still exits. This is not an attempt to keep running through a fault the
 * process cannot reason about -- Kamal restarts the container, and a bot that
 * limps on after an unknown failure is worse than one that comes back clean.
 * The only thing being bought is that the cause survives the exit.
 */
export function createFatalHandler(exit: (code: number) => void = process.exit) {
  return function die(error: unknown, source: string): void {
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
    const deadline = setTimeout(() => exit(1), FATAL_REPORT_TIMEOUT_MS);

    void reportFatal(error, source)
      .catch(() => {})
      .then(() => shutdownTelemetry())
      .catch(() => {})
      .finally(() => {
        clearTimeout(deadline);
        exit(1);
      });
  };
}

/**
 * The last-resort handler for a failure during startup.
 *
 * These are the ones worth seeing most and the ones most likely to be lost:
 * nothing has been flushed yet, so without the awaited report the batch dies
 * here along with the explanation.
 */
export async function reportStartupFailure(error: unknown, exit: (code: number) => void = process.exit): Promise<void> {
  log.fatal({ err: error }, 'Fatal error');
  await reportFatal(error, 'discord:startup-failed');
  exit(1);
}
