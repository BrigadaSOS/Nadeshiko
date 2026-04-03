import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { search, downloadFile } from '../api';
import { buildSegmentMessage } from '../embeds';
import { launchContextBrowser } from './contextBrowser';
import { BOT_CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Get a random Japanese sentence')
  .addStringOption((opt) => opt.setName('query').setDescription('Optional search filter').setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query') || '*';

  try {
    const result = await fetchRandom(query);

    if (result.segments.length === 0) {
      await interaction.editReply({ content: 'No results found.' });
      return;
    }

    let currentSegment = result.segments[0];
    let currentMedia = result.includes.media[currentSegment.mediaPublicId];

    const content = buildSegmentMessage(currentSegment, currentMedia);
    const row = buildButtons(currentSegment.publicId);

    const videoBuffer = await downloadFile(currentSegment.urls.videoUrl);
    const files = videoBuffer ? [new AttachmentBuilder(videoBuffer, { name: `${currentSegment.publicId}.mp4` })] : [];

    const reply = await interaction.editReply({ content, components: [row], files });

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    collector.on('collect', async (btnInteraction) => {
      if (!btnInteraction.isButton()) return;

      if (btnInteraction.customId === 'context') {
        await launchContextBrowser(btnInteraction, currentSegment.publicId);
        return;
      }

      if (btnInteraction.customId === 'reroll') {
        await btnInteraction.deferUpdate();
        const newResult = await fetchRandom(query);
        if (newResult.segments.length === 0) return;

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];

        const newContent = buildSegmentMessage(currentSegment, currentMedia);
        const newRow = buildButtons(currentSegment.publicId);

        const newVideoBuffer = await downloadFile(currentSegment.urls.videoUrl);
        const newFiles = newVideoBuffer
          ? [new AttachmentBuilder(newVideoBuffer, { name: `${currentSegment.publicId}.mp4` })]
          : [];

        await btnInteraction.editReply({ content: newContent, components: [newRow], files: newFiles });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {}
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `Failed: ${msg}` });
  }
}

function buildButtons(publicId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('reroll').setLabel('Another one').setStyle(ButtonStyle.Primary).setEmoji('🎲'),
    new ButtonBuilder().setCustomId('context').setLabel('Context').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(`${BOT_CONFIG.frontendUrl}/sentence/${publicId}`),
  );
}

function fetchRandom(query: string) {
  return search(query, {
    take: 1,
    sort: 'RANDOM',
    seed: Math.floor(Math.random() * 1_000_000),
  });
}
