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

  console.log(`Registering ${commandData.length} slash commands...`);

  const data = await rest.put(Routes.applicationCommands(getApplicationId()), {
    body: commandData,
  });

  console.log(`Registered ${(data as unknown[]).length} commands globally.`);
}

function getApplicationId(): string {
  const tokenParts = BOT_CONFIG.token.split('.');
  return Buffer.from(tokenParts[0], 'base64').toString();
}

async function main() {
  if (!BOT_CONFIG.token) {
    console.error('DISCORD_BOT_TOKEN is required');
    process.exit(1);
  }

  console.log('API base URL:', BOT_CONFIG.apiBaseUrl);

  await registerCommands();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Bot online as ${readyClient.user.tag}`);
    console.log(
      `Invite URL: https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&permissions=2147483648&scope=bot%20applications.commands`,
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing /${interaction.commandName}:`, error);
      const content = 'Something went wrong executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  });

  await client.login(BOT_CONFIG.token);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
