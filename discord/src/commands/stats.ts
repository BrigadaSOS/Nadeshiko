import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getStats } from '../api';
import { buildStatsEmbed } from '../embeds';

export const data = new SlashCommandBuilder().setName('stats').setDescription('Show Nadeshiko corpus statistics');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const stats = await getStats();
    const embed = buildStatsEmbed(stats);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `Failed to get stats: ${msg}` });
  }
}
