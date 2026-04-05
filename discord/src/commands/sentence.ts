import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getSegmentByUuid } from '../api';
import {
  renderSegmentReply,
  createContextState,
  handleContextButton,
  handleContextSelect,
  handleBackToOriginal,
  buildLinkOnlyRow,
} from '../segmentReply';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';
import { getGuildSettings } from '../settings';

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
    const { segment, media } = await getSegmentByUuid(id);
    const display = getGuildSettings(interaction.guildId);
    const contextState = createContextState();

    const reply = await renderSegmentReply({
      interaction,
      segment,
      media: media ?? undefined,
      display,
    });

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'context') {
        await handleContextButton(i, segment, media ?? undefined, display, contextState);
        return;
      }

      if (i.customId === 'back_to_original') {
        await handleBackToOriginal(i, display, contextState);
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [buildLinkOnlyRow(segment.publicId)] });
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Sentence command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}
