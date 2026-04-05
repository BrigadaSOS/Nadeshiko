import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { autocompleteMedia, search } from '../api';
import type { Segment, Media } from '../api';
import { buildMediaSearchMessage, getMediaName, type DisplayOptions } from '../embeds';
import {
  updateSegmentReply,
  createContextState,
  handleContextButton,
  handleContextSelect,
  handleBackToOriginal,
  buildLinkOnlyRow,
} from '../segmentReply';
import {
  advancedSearchButton,
  createSearchModalState,
  showSearchModal,
  showFilterMediaSelect,
  handleFilterMediaSelect,
  createFilterMediaState,
  renderFilterMediaPage,
  filterMediaButton,
  renderSearchResult,
  setupModalListener,
} from '../searchModal';
import { BOT_CONFIG } from '../config';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';
import { getGuildSettings } from '../settings';

const log = createLogger('cmd:media');

export const data = new SlashCommandBuilder()
  .setName('media')
  .setDescription('Search for anime or drama in Nadeshiko')
  .addStringOption((opt) => opt.setName('query').setDescription('Name of the anime or drama').setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName('category')
      .setDescription('Filter by category')
      .setRequired(false)
      .addChoices({ name: 'Anime', value: 'ANIME' }, { name: 'J-Drama', value: 'JDRAMA' }),
  );

function fetchRandomFromMedia(mediaId: string) {
  return search('*', {
    take: 1,
    sort: 'RANDOM',
    seed: Math.floor(Math.random() * 1_000_000),
    mediaId,
  });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  const category = interaction.options.getString('category') as 'ANIME' | 'JDRAMA' | null;

  try {
    const result = await autocompleteMedia(query);
    const media = category ? result.media.filter((m) => m.category === category) : result.media;

    const content = buildMediaSearchMessage(media, query);

    if (media.length === 0) {
      await interaction.editReply({ content });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('media_select')
      .setPlaceholder('Get sentences from...')
      .addOptions(
        media.slice(0, 25).map((m, i) => ({
          label: `${i + 1}. ${getMediaName(m).slice(0, 90)}`,
          value: m.publicId,
          description: m.nameJa?.slice(0, 100),
        })),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    const reply = await interaction.editReply({ content, components: [row] });

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    let currentSegment: Segment | null = null;
    let currentMedia: Media | undefined;
    const contextState = createContextState();
    const searchState = createSearchModalState();
    const filterState = createFilterMediaState();
    const display: DisplayOptions = getGuildSettings(interaction.guildId);

    const rerollButton = new ButtonBuilder()
      .setCustomId('reroll')
      .setLabel('Another one')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎲');

    const randomButtons = [rerollButton, advancedSearchButton, filterMediaButton];

    const getMediaUrl = () => {
      const slug = media.find((m) => m.publicId === searchState.mediaId)?.slug ?? searchState.mediaId;
      return `${BOT_CONFIG.frontendUrl}/media/${slug}`;
    };

    const cleanupModal = setupModalListener(
      interaction.client,
      interaction.user.id,
      searchState,
      display,
      getMediaUrl,
      [rerollButton],
    );

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'media_select') {
        await i.deferUpdate();

        const mediaId = i.values[0];
        searchState.mediaId = mediaId;
        const selected = media.find((m) => m.publicId === mediaId);
        searchState.mediaName = getMediaName(selected);

        const randomResult = await fetchRandomFromMedia(mediaId);

        if (randomResult.segments.length === 0) {
          await i.followUp({ content: `No sentences found in **${searchState.mediaName}**.`, ephemeral: true });
          return;
        }

        currentSegment = randomResult.segments[0];
        currentMedia = randomResult.includes.media[currentSegment.mediaPublicId];
        searchState.results = null;
        contextState.viewingContext = false;

        await updateSegmentReply(i, currentSegment, currentMedia, display, randomButtons);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'search_select' && searchState.results) {
        await i.deferUpdate();
        const idx = searchState.results.segments.findIndex((s) => s.publicId === i.values[0]);
        if (idx === -1) return;
        searchState.currentIndex = idx;
        contextState.viewingContext = false;

        currentSegment = searchState.results.segments[idx];
        currentMedia = searchState.results.includes.media[currentSegment.mediaPublicId];

        await renderSearchResult(i, searchState, display, getMediaUrl(), [rerollButton]);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'filter_media_select') {
        await i.deferUpdate();
        handleFilterMediaSelect(i, searchState);

        if (!searchState.mediaId) return;

        const newResult = await fetchRandomFromMedia(searchState.mediaId);
        if (newResult.segments.length === 0) {
          await i.followUp({ content: `No sentences found in **${searchState.mediaName}**.`, ephemeral: true });
          return;
        }

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];
        contextState.viewingContext = false;
        searchState.results = null;

        await updateSegmentReply(i, currentSegment, currentMedia, display, randomButtons);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'context' && currentSegment) {
        const extraBtns = searchState.results ? [advancedSearchButton] : randomButtons;
        await handleContextButton(i, currentSegment, currentMedia, display, contextState, extraBtns);
        return;
      }

      if (i.customId === 'back_to_original') {
        if (searchState.results) {
          await i.deferUpdate();
          contextState.viewingContext = false;
          await renderSearchResult(i, searchState, display, getMediaUrl(), [rerollButton]);
        } else {
          await handleBackToOriginal(i, display, contextState, randomButtons);
        }
        return;
      }

      if (i.customId === 'reroll' && searchState.mediaId) {
        await i.deferUpdate();
        contextState.viewingContext = false;
        searchState.results = null;

        const newResult = await fetchRandomFromMedia(searchState.mediaId);
        if (newResult.segments.length === 0) return;

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];

        await updateSegmentReply(i, currentSegment, currentMedia, display, randomButtons);
        return;
      }

      if (i.customId === 'advanced_search' && searchState.mediaId) {
        await showSearchModal(i, `Search in ${searchState.mediaName}`);
        return;
      }

      if (i.customId === 'filter_media') {
        await showFilterMediaSelect(i, searchState, filterState);
        return;
      }

      if (i.customId === 'cancel_filter_media') {
        await i.deferUpdate();
        if (searchState.results) {
          await renderSearchResult(i, searchState, display, getMediaUrl(), [rerollButton]);
        } else if (currentSegment) {
          await updateSegmentReply(i, currentSegment, currentMedia, display, randomButtons);
        }
        return;
      }

      if (i.customId === 'filter_media_prev') {
        await i.deferUpdate();
        filterState.mediaPage = Math.max(0, filterState.mediaPage - 1);
        await renderFilterMediaPage(i, searchState, filterState);
        return;
      }

      if (i.customId === 'filter_media_next') {
        await i.deferUpdate();
        filterState.mediaPage++;
        await renderFilterMediaPage(i, searchState, filterState);
      }
    });

    collector.on('end', async () => {
      cleanupModal();
      try {
        if (currentSegment) {
          await interaction.editReply({ components: [buildLinkOnlyRow(currentSegment.publicId)] });
        } else {
          await interaction.editReply({ components: [] });
        }
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Media command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}
