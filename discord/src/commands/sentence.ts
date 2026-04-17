import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { getSegment } from '../api';
import { getMediaName } from '../embeds';
import {
  renderSegmentReply,
  createContextState,
  handleContextButton,
  handleContextSelect,
  handleBackToOriginal,
  buildLinkOnlyRow,
} from '../segmentReply';
import { BOT_CONFIG } from '../config';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';
import { getGuildSettings } from '../settings';
import { executeSearch } from './search';

const log = createLogger('cmd:sentence');

export const data = new SlashCommandBuilder()
  .setName('sentence')
  .setDescription('Look up a specific sentence by ID or Nadeshiko URL')
  .addStringOption((opt) =>
    opt.setName('id').setDescription('Segment public ID, UUID, or Nadeshiko URL').setRequired(true),
  );

export function parseSegmentId(input: string): string {
  const urlMatch = input.match(/nadeshiko\.co\/sentence\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return input.trim();
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const id = parseSegmentId(interaction.options.getString('id', true));

  try {
    const { segment, media } = await getSegment(id);
    const resolvedMedia = media ?? undefined;
    const display = getGuildSettings(interaction.guildId);
    const contextState = createContextState();
    const mediaName = getMediaName(resolvedMedia);

    const params = new URLSearchParams();
    if (resolvedMedia) {
      params.set('media', resolvedMedia.mediaPublicId);
      params.set('episode', String(segment.episode));
    }
    const qs = params.toString();
    const linkUrl = qs ? `${BOT_CONFIG.frontendUrl}/search?${qs}` : `${BOT_CONFIG.frontendUrl}/search`;

    const extraButtons: ButtonBuilder[] = [];
    if (resolvedMedia) {
      extraButtons.push(
        new ButtonBuilder()
          .setCustomId('search_in_media')
          .setLabel('Search in media')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎬'),
        new ButtonBuilder()
          .setCustomId('search_in_episode')
          .setLabel('Search in episode')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📺'),
      );
    }

    const reply = await renderSegmentReply({
      interaction,
      segment,
      media: resolvedMedia,
      display,
      linkUrl,
      extraButtons,
      contentPrefix: `🔎 Sentence from **${mediaName}** • Episode ${segment.episode}`,
    });

    const collector = reply.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'context') {
        await handleContextButton(i, segment, resolvedMedia, display, contextState, extraButtons);
        return;
      }

      if (i.customId === 'back_to_original') {
        await handleBackToOriginal(i, display, contextState, linkUrl, extraButtons);
        return;
      }

      if ((i.customId === 'search_in_media' || i.customId === 'search_in_episode') && resolvedMedia) {
        collector.stop('search_transition');
        await executeSearch(i, {
          mediaPublicId: resolvedMedia.mediaPublicId,
          episodes: i.customId === 'search_in_episode' ? [segment.episode] : undefined,
          display,
        });
        return;
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'search_transition') return;
      try {
        const params = new URLSearchParams();
        if (resolvedMedia) {
          params.set('media', resolvedMedia.mediaPublicId);
          params.set('episode', String(segment.episode));
        }
        const qs = params.toString();
        const url = qs ? `${BOT_CONFIG.frontendUrl}/search?${qs}` : `${BOT_CONFIG.frontendUrl}/search`;
        await interaction.editReply({ components: [buildLinkOnlyRow(url)] });
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Sentence command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}
