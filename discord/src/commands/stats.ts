import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getStats } from '../api';
import { buildStatsEmbed } from '../embeds';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';

const log = createLogger('cmd:stats');

export const data = new SlashCommandBuilder().setName('stats').setDescription('Show Nadeshiko corpus statistics');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const stats = await getStats();
    const embed = buildStatsEmbed(stats);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Stats command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}
