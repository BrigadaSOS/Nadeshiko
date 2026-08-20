import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { DISCORD_INVITE_URL, aboutUrl, botInstallUrl, homeUrl } from '../links';
import { anywhere } from '../install';

export const data = anywhere(
  new SlashCommandBuilder().setName('info').setDescription('About Nadeshiko and useful links'),
);

export async function execute(interaction: ChatInputCommandInteraction) {
  const lines = [
    `🌸 **[Nadeshiko: Japanese Sentence Search Engine](<${homeUrl()}>)**`,
    '',
    `Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.`,
    '',
    `Nadeshiko is built for and by the Japanese language learning community, and will always be provided **for free**. If you find our work useful, consider supporting us on **Patreon**:`,
    `- <https://patreon.com/BrigadaSOS>`,
    '',
    `Found a bug or have a suggestion? Join our **Discord server**:`,
    `- ${DISCORD_INVITE_URL}`,
  ];

  // The people reading this already know the bot exists, which makes them the
  // cheapest audience there is for the one thing the website cannot reach: a
  // personal install, usable in servers where nobody will ever add a bot.
  const installUrl = botInstallUrl(interaction.client.application.id);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Homepage')
      .setStyle(ButtonStyle.Link)
      .setURL(homeUrl())
      .setEmoji({ id: '1488442092823777410' }),
    new ButtonBuilder()
      .setLabel('About')
      .setStyle(ButtonStyle.Link)
      .setURL(aboutUrl())
      .setEmoji({ id: '1488442092823777410' }),
    new ButtonBuilder()
      .setLabel('Patreon')
      .setStyle(ButtonStyle.Link)
      .setURL('https://patreon.com/BrigadaSOS')
      .setEmoji('💜'),
    new ButtonBuilder().setLabel('Add to Discord').setStyle(ButtonStyle.Link).setURL(installUrl).setEmoji('➕'),
  );

  await interaction.reply({ content: lines.join('\n'), components: [row] });
}
