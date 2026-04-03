import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getSegmentContext } from '../api';
import { buildContextMessage } from '../embeds';

export const data = new SlashCommandBuilder()
  .setName('context')
  .setDescription('Show surrounding dialogue for a sentence')
  .addStringOption((opt) => opt.setName('id').setDescription('Segment public ID').setRequired(true))
  .addIntegerOption((opt) =>
    opt
      .setName('lines')
      .setDescription('Number of lines before/after (1-15)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(15),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const id = interaction.options.getString('id', true);
  const lines = interaction.options.getInteger('lines') ?? 5;

  try {
    const result = await getSegmentContext(id, lines);
    const content = buildContextMessage(result, id);
    await interaction.editReply({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `Failed to get context: ${msg}` });
  }
}
