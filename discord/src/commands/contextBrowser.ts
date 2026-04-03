import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, type ButtonInteraction } from 'discord.js';
import { getSegmentContext, downloadFile } from '../api';
import { buildSegmentMessage } from '../embeds';
import type { Segment, MediaInfo } from '../api';
import { BOT_CONFIG } from '../config';

type ContextState = {
  segments: Segment[];
  mediaMap: Record<string, MediaInfo>;
  currentIndex: number;
  originPublicId: string;
};

export async function launchContextBrowser(btnInteraction: ButtonInteraction, originPublicId: string) {
  await btnInteraction.deferReply();

  const contextResult = await getSegmentContext(originPublicId, 10);

  if (contextResult.segments.length === 0) {
    await btnInteraction.editReply({ content: 'No context found.' });
    return;
  }

  const state: ContextState = {
    segments: contextResult.segments,
    mediaMap: contextResult.includes.media,
    currentIndex: contextResult.segments.findIndex((s) => s.publicId === originPublicId),
    originPublicId,
  };

  if (state.currentIndex === -1) state.currentIndex = 0;

  await renderSegment(btnInteraction, state);

  const reply = await btnInteraction.fetchReply();

  const collector = reply.createMessageComponentCollector({ time: 600_000 });

  collector.on('collect', async (i) => {
    if (!i.isButton()) return;

    await i.deferUpdate();

    if (i.customId === 'ctx_prev' && state.currentIndex > 0) {
      state.currentIndex--;
    } else if (i.customId === 'ctx_next' && state.currentIndex < state.segments.length - 1) {
      state.currentIndex++;
    } else if (i.customId === 'ctx_origin') {
      state.currentIndex = state.segments.findIndex((s) => s.publicId === state.originPublicId);
      if (state.currentIndex === -1) state.currentIndex = 0;
    }

    await renderSegment(i, state);
  });

  collector.on('end', async () => {
    try {
      const seg = state.segments[state.currentIndex];
      const media = state.mediaMap[seg.mediaPublicId];
      const content = buildSegmentMessage(seg, media);
      await btnInteraction.editReply({ content, components: [], files: [] });
    } catch {}
  });
}

async function renderSegment(interaction: ButtonInteraction, state: ContextState) {
  const seg = state.segments[state.currentIndex];
  const media = state.mediaMap[seg.mediaPublicId];
  const isOrigin = seg.publicId === state.originPublicId;

  const content = buildSegmentMessage(seg, media);
  const position = `${state.currentIndex + 1}/${state.segments.length}`;
  const header = isOrigin ? `**[Context ${position}]** (original)\n` : `**[Context ${position}]**\n`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ctx_prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.currentIndex === 0),
    new ButtonBuilder()
      .setCustomId('ctx_origin')
      .setLabel('Back to original')
      .setStyle(isOrigin ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctx_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.currentIndex === state.segments.length - 1),
    new ButtonBuilder()
      .setLabel('View on Nadeshiko')
      .setStyle(ButtonStyle.Link)
      .setURL(`${BOT_CONFIG.frontendUrl}/sentence/${seg.publicId}`),
  );

  const videoBuffer = await downloadFile(seg.urls.videoUrl);
  const files = videoBuffer ? [new AttachmentBuilder(videoBuffer, { name: `${seg.publicId}.mp4` })] : [];

  await interaction.editReply({
    content: header + content,
    components: [row],
    files,
  });
}
