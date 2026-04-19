import { type Message } from 'discord.js';
import { getSegment } from './api';
import { buildSegmentMessage } from './embeds';
import { BOT_CONFIG } from './config';
import {
  buildSegmentButtons,
  loadVideoFiles,
  buildLinkOnlyRow,
  createContextState,
  handleContextButton,
  handleContextSelect,
  handleBackToOriginal,
} from './segmentReply';
import { createLogger } from './logger';
import { getGuildSettings } from './settings';

const log = createLogger('autoEmbed');

const NADESHIKO_URL_PATTERN = /nadeshiko\.co\/sentence\/([A-Za-z0-9_-]+)/g;

export async function handleAutoEmbed(message: Message) {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const settings = getGuildSettings(message.guildId);
  if (!settings.autoEmbed) return;

  const matches = [...message.content.matchAll(NADESHIKO_URL_PATTERN)];
  if (matches.length === 0) return;

  const segmentId = matches[0][1];

  try {
    const { segment, media } = await getSegment(segmentId);
    const params = new URLSearchParams();
    if (media) {
      params.set('media', media.publicId);
      params.set('episode', String(segment.episode));
    }
    const qs = params.toString();
    const linkUrl = qs ? `${BOT_CONFIG.frontendUrl}/search?${qs}` : `${BOT_CONFIG.frontendUrl}/search`;

    const content = buildSegmentMessage(segment, media ?? undefined, settings);
    const row = buildSegmentButtons(linkUrl);
    const files = await loadVideoFiles(segment);

    const reply = await message.reply({ content, components: [row], files });

    const contextState = createContextState();
    const collector = reply.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, settings, contextState);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'context') {
        await handleContextButton(i, segment, media ?? undefined, settings, contextState);
        return;
      }

      if (i.customId === 'back_to_original') {
        await handleBackToOriginal(i, settings, contextState, linkUrl);
      }
    });

    collector.on('end', async () => {
      try {
        const params = new URLSearchParams();
        if (media) {
          params.set('media', media.publicId);
          params.set('episode', String(segment.episode));
        }
        const qs = params.toString();
        const url = qs ? `${BOT_CONFIG.frontendUrl}/search?${qs}` : `${BOT_CONFIG.frontendUrl}/search`;
        await reply.edit({ components: [buildLinkOnlyRow(url)] });
      } catch {}
    });
  } catch (error) {
    log.error({ err: error, segmentId }, 'Auto-embed failed');
  }
}
