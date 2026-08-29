import { Client, GatewayIntentBits, PermissionFlagsBits, Collection, Events } from 'discord.js';
import { BOT_CONFIG, validateConfig } from './config';
import { createLogger } from './logger';
import { recordRateLimit } from './analytics';
import { createInteractionHandler, handleGuildCreate, handleGuildDelete } from './events';
import {
  createFatalHandler,
  createReadyHandler,
  createShutdown,
  registerCommands,
  reportStartupFailure,
} from './lifecycle';
import { startHealthServer } from './health';
import { initSdk } from './api';
import { initSettings } from './settings';
import { allCommands, type Command } from './commands';

const log = createLogger('bot');

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

async function main() {
  validateConfig();

  initSdk();
  initSettings();

  log.info({ apiBaseUrl: BOT_CONFIG.apiBaseUrl }, 'Starting bot');

  if (process.env.REGISTER_COMMANDS === 'true') {
    await registerCommands(allCommands);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, createReadyHandler(INVITE_PERMISSIONS));

  client.on(Events.InteractionCreate, createInteractionHandler(commands));

  client.on(Events.GuildCreate, (guild) => {
    handleGuildCreate(guild);
  });

  client.on(Events.GuildDelete, (guild) => {
    handleGuildDelete(guild);
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

  const shutdown = createShutdown({ healthServer, client });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const die = createFatalHandler();

  process.on('uncaughtException', (error) => die(error, 'discord:uncaught-exception'));
  process.on('unhandledRejection', (reason) => die(reason, 'discord:unhandled-rejection'));
}

main().catch(reportStartupFailure);
