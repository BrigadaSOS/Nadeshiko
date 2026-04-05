import { REST, Routes } from 'discord.js';
import { BOT_CONFIG, getApplicationId } from './config';
import { createLogger } from './logger';
import { allCommands } from './commands';

const log = createLogger('register');

const token = BOT_CONFIG.token;
if (!token) {
  log.fatal('DISCORD_BOT_TOKEN is required');
  process.exit(1);
}

const applicationId = getApplicationId();

const rest = new REST({ version: '10' }).setToken(token);
const commandData = allCommands.map((cmd) => cmd.data.toJSON());

const guildId = process.env.DISCORD_GUILD_ID;

if (process.argv.includes('--clear-global')) {
  log.info('Clearing global commands');
  await rest.put(Routes.applicationCommands(applicationId), { body: [] });
  log.info('Global commands cleared');
}

if (guildId) {
  log.info({ count: commandData.length, guildId }, 'Registering guild commands');
  const data = await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
    body: commandData,
  });
  log.info({ count: (data as unknown[]).length, guildId }, 'Registered guild commands');
} else {
  log.info({ count: commandData.length }, 'Registering global commands');
  const data = await rest.put(Routes.applicationCommands(applicationId), {
    body: commandData,
  });
  log.info({ count: (data as unknown[]).length }, 'Registered commands globally');
}
