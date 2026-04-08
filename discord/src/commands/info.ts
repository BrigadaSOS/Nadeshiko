import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { BOT_CONFIG } from '../config';

export const data = new SlashCommandBuilder().setName('info').setDescription('About Nadeshiko and useful links');

export async function execute(interaction: ChatInputCommandInteraction) {
  const lines = [
    `🌸 **[Nadeshiko: Japanese Sentence Search Engine](<${BOT_CONFIG.frontendUrl}>)**`,
    '',
    `Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.`,
    '',
    `Nadeshiko is built for and by the Japanese language learning community, and will always be provided **for free**. If you find our work useful, consider supporting us on **Patreon**:`,
    `- <https://patreon.com/BrigadaSOS>`,
    '',
    `Found a bug or have a suggestion? Join our **Discord server**:`,
    `- https://discord.gg/c6yGwbXruq`,
  ];

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Homepage').setStyle(ButtonStyle.Link).setURL(BOT_CONFIG.frontendUrl).setEmoji({ id: '1488442092823777410' }),
    new ButtonBuilder().setLabel('About').setStyle(ButtonStyle.Link).setURL(`${BOT_CONFIG.frontendUrl}/about`).setEmoji({ id: '1488442092823777410' }),
    new ButtonBuilder().setLabel('Patreon').setStyle(ButtonStyle.Link).setURL('https://patreon.com/BrigadaSOS').setEmoji('💜'),
  );

  await interaction.reply({ content: lines.join('\n'), components: [row] });
}
