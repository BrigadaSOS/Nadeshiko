import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { executeSearch } from './search';
import { getGuildSettings, type Language } from '../settings';

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Get a random Japanese sentence')
  .addStringOption((opt) =>
    opt
      .setName('language')
      .setDescription('Override translation language')
      .setRequired(false)
      .addChoices(
        { name: 'English', value: 'en' },
        { name: 'Spanish', value: 'es' },
        { name: 'Both', value: 'both' },
        { name: 'None', value: 'none' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('media')
      .setDescription('Filter by anime/drama (type to search)')
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const settings = getGuildSettings(interaction.guildId);
  await executeSearch(interaction, {
    mediaPublicId: interaction.options.getString('media') ?? undefined,
    display: {
      language: (interaction.options.getString('language') as Language) ?? settings.language,
    },
  });
}
