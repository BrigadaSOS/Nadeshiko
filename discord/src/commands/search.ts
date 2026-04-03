import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { search, getSegmentContext, downloadFile } from '../api';
import { buildSearchResultMessages, buildContextMessage } from '../embeds';
import { BOT_CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search for Japanese sentences in anime and drama')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('Search query (Japanese, English, or romaji)').setRequired(true),
  )
  .addBooleanOption((opt) => opt.setName('exact').setDescription('Exact phrase match').setRequired(false))
  .addStringOption((opt) =>
    opt
      .setName('category')
      .setDescription('Filter by category')
      .setRequired(false)
      .addChoices({ name: 'Anime', value: 'ANIME' }, { name: 'J-Drama', value: 'JDRAMA' }),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  const exact = interaction.options.getBoolean('exact') ?? false;
  const category = interaction.options.getString('category');

  try {
    const result = await search(query, {
      exactMatch: exact,
      take: BOT_CONFIG.maxSearchResults,
      category: category ?? undefined,
    });

    const [content] = buildSearchResultMessages(result, query);
    const components = buildComponents(result.segments, result.pagination.hasMore);

    const reply = await interaction.editReply({ content, components });

    if (!result.pagination.hasMore && result.segments.length === 0) return;

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    let currentCursor = result.pagination.cursor;
    let currentSegments = result.segments;

    collector.on('collect', async (i: ButtonInteraction | StringSelectMenuInteraction) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: 'Only the command author can use these buttons.', ephemeral: true });
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await i.deferUpdate();
        const publicId = i.values[0];
        const contextResult = await getSegmentContext(publicId);
        const contextContent = buildContextMessage(contextResult, publicId);
        await i.followUp({ content: contextContent, ephemeral: true });
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'play_select') {
        await i.deferUpdate();
        const publicId = i.values[0];
        const seg = currentSegments.find((s) => s.publicId === publicId);
        if (seg) {
          const videoBuffer = await downloadFile(seg.urls.videoUrl);
          if (videoBuffer) {
            await i.followUp({
              files: [new AttachmentBuilder(videoBuffer, { name: `${seg.publicId}.mp4` })],
            });
          }
        }
        return;
      }

      if (i.isButton() && i.customId === 'next' && currentCursor) {
        await i.deferUpdate();
        const nextResult = await search(query, {
          exactMatch: exact,
          take: BOT_CONFIG.maxSearchResults,
          cursor: currentCursor,
          category: category ?? undefined,
        });
        currentCursor = nextResult.pagination.cursor;
        currentSegments = nextResult.segments;
        const [nextContent] = buildSearchResultMessages(nextResult, query);
        const nextComponents = buildComponents(nextResult.segments, nextResult.pagination.hasMore);
        await i.editReply({ content: nextContent, components: nextComponents });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {}
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `Search failed: ${msg}` });
  }
}

type SegmentLike = { publicId: string; textJa: { content: string } };

function buildComponents(
  segments: SegmentLike[],
  hasMore: boolean,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (segments.length > 0) {
    const contextMenu = new StringSelectMenuBuilder()
      .setCustomId('context_select')
      .setPlaceholder('View context...')
      .addOptions(
        segments.map((seg, i) => ({
          label: `#${i + 1}: ${seg.textJa.content.slice(0, 80)}`,
          value: seg.publicId,
          description: `ID: ${seg.publicId}`,
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(contextMenu));

    const playMenu = new StringSelectMenuBuilder()
      .setCustomId('play_select')
      .setPlaceholder('Play video clip...')
      .addOptions(
        segments.map((seg, i) => ({
          label: `#${i + 1}: ${seg.textJa.content.slice(0, 80)}`,
          value: seg.publicId,
          description: `ID: ${seg.publicId}`,
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(playMenu));
  }

  if (hasMore || segments.length > 0) {
    const navButtons: ButtonBuilder[] = [];
    if (hasMore) {
      navButtons.push(new ButtonBuilder().setCustomId('next').setLabel('Next page').setStyle(ButtonStyle.Primary));
    }
    if (segments.length > 0) {
      navButtons.push(
        new ButtonBuilder()
          .setLabel('Open in Nadeshiko')
          .setStyle(ButtonStyle.Link)
          .setURL(`${BOT_CONFIG.frontendUrl}/search`),
      );
    }
    if (navButtons.length > 0) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(navButtons));
    }
  }

  return rows;
}
