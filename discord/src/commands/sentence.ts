import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getSegmentByUuid, downloadFile } from '../api';
import { buildSegmentMessage } from '../embeds';
import { launchContextBrowser } from './contextBrowser';
import { BOT_CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('sentence')
  .setDescription('Look up a specific sentence by ID')
  .addStringOption((opt) => opt.setName('id').setDescription('Segment public ID or UUID').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const id = interaction.options.getString('id', true);

  try {
    const { segment, media } = await getSegmentByUuid(id);
    const content = buildSegmentMessage(segment, media ?? undefined);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('context').setLabel('Context').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('View on Nadeshiko')
        .setStyle(ButtonStyle.Link)
        .setURL(`${BOT_CONFIG.frontendUrl}/sentence/${segment.publicId}`),
    );

    const videoBuffer = await downloadFile(segment.urls.videoUrl);
    const files = videoBuffer ? [new AttachmentBuilder(videoBuffer, { name: `${segment.publicId}.mp4` })] : [];

    const reply = await interaction.editReply({ content, components: [row], files });

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    collector.on('collect', async (btnInteraction) => {
      if (btnInteraction.isButton() && btnInteraction.customId === 'context') {
        await launchContextBrowser(btnInteraction, segment.publicId);
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {}
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `Failed to find sentence: ${msg}` });
  }
}
