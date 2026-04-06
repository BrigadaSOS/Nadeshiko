import { Client, GatewayIntentBits, REST, Routes, Collection, Events } from 'discord.js';
import { BOT_CONFIG, getApplicationId } from './config';
import { createLogger } from './logger';
import { initTelemetry, shutdownTelemetry } from './telemetry';
import { traceCommand } from './instrumentation';
import { startHealthServer } from './health';
import { initSdk } from './api';
import { initSettings } from './settings';
import { handleAutoEmbed } from './autoEmbed';
import { allCommands, type Command } from './commands';
import { searchMediaCache } from './mediaCache';
import { getMediaName } from './embeds';

const log = createLogger('bot');

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
  if (!BOT_CONFIG.token) {
    log.fatal('DISCORD_BOT_TOKEN is required');
    process.exit(1);
  }

  initTelemetry();
  initSdk();
  initSettings();

  log.info({ apiBaseUrl: BOT_CONFIG.apiBaseUrl }, 'Starting bot');

  if (process.env.REGISTER_COMMANDS === 'true') {
    await registerCommands();
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
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
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'media') {
        try {
          const results = await searchMediaCache(focused.value);
          await interaction.respond(
            results.map((m) => ({
              name: getMediaName(m).slice(0, 100),
              value: m.publicId,
            })),
          );
        } catch (error) {
          log.error({ err: error }, 'Media autocomplete failed');
        }
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
      const content = 'Something went wrong executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleAutoEmbed(message);
    } catch (error) {
      log.error({ err: error }, 'Auto-embed error');
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
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error');
  process.exit(1);
});
