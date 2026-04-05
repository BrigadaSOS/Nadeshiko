import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  type ChatInputCommandInteraction,
  Events,
} from 'discord.js';
import { BOT_CONFIG } from './config';
import { createLogger } from './logger';
import { initSentry, shutdownSentry, Sentry } from './sentry';
import { initTelemetry, shutdownTelemetry } from './telemetry';
import { initInstrumentation, traceCommand } from './instrumentation';
import { startHealthServer } from './health';
import { initSdk } from './api';

const log = createLogger('bot');

import * as searchCmd from './commands/search';
import * as contextCmd from './commands/context';
import * as sentenceCmd from './commands/sentence';
import * as randomCmd from './commands/random';
import * as statsCmd from './commands/stats';

type Command = {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const commands = new Collection<string, Command>();
const allCommands: Command[] = [searchCmd, contextCmd, sentenceCmd, randomCmd, statsCmd];

for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_CONFIG.token);
  const commandData = allCommands.map((cmd) => cmd.data.toJSON());

  log.info({ count: commandData.length }, 'Registering slash commands');

  const data = await rest.put(Routes.applicationCommands(getApplicationId()), {
    body: commandData,
  });

  log.info({ count: (data as unknown[]).length }, 'Registered commands globally');
}

function getApplicationId(): string {
  const tokenParts = BOT_CONFIG.token.split('.');
  return Buffer.from(tokenParts[0], 'base64').toString();
}

async function main() {
  if (!BOT_CONFIG.token) {
    log.fatal('DISCORD_BOT_TOKEN is required');
    process.exit(1);
  }

  initSentry();
  initTelemetry();
  initInstrumentation();
  initSdk();

  log.info({ apiBaseUrl: BOT_CONFIG.apiBaseUrl }, 'Starting bot');

  await registerCommands();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    log.info({ tag: readyClient.user.tag }, 'Bot online');
    log.info(
      {
        url: `https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&permissions=2147483648&scope=bot%20applications.commands`,
      },
      'Invite URL',
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await traceCommand(interaction.commandName, interaction, () => command.execute(interaction));
    } catch (error) {
      log.error({ err: error, command: interaction.commandName }, 'Error executing command');
      Sentry.captureException(error, {
        tags: { command: interaction.commandName },
        extra: { guildId: interaction.guildId, channelId: interaction.channelId },
      });
      const content = 'Something went wrong executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.rest.on('rateLimited', (info) => {
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
    await shutdownTelemetry();
    await shutdownSentry();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error');
  process.exit(1);
});
