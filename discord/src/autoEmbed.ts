import { type Message } from 'discord.js';
import { getSegmentByUuid } from './api';
import { buildSegmentMessage } from './embeds';
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
    const { segment, media } = await getSegmentByUuid(segmentId);
    const content = buildSegmentMessage(segment, media ?? undefined, settings);
    const row = buildSegmentButtons(segment.publicId);

    const files = await loadVideoFiles(segment);

    const reply = await message.reply({ content, components: [row], files });

    const contextState = createContextState();
    const collector = reply.createMessageComponentCollector({ time: 300_000 });

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
        await handleBackToOriginal(i, settings, contextState);
      }
    });

    collector.on('end', async () => {
      try {
        await reply.edit({ components: [buildLinkOnlyRow(segment.publicId)] });
      } catch {}
    });
  } catch (error) {
    log.error({ err: error, segmentId }, 'Auto-embed failed');
  }
}
