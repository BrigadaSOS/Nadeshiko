import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { searchMedia, fetchRandom } from '../api';
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
  showFilterMediaSearchModal,
  handleFilterMediaSelect,
  createFilterMediaState,
  renderFilterMediaPage,
  filterMediaButton,
  renderSearchResult,
  setupModalListener,
  MEDIA_PER_PAGE,
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

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  const category = interaction.options.getString('category') as 'ANIME' | 'JDRAMA' | null;

  try {
    const result = await searchMedia(query);
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
          value: m.mediaPublicId,
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
      const params = new URLSearchParams();
      if (searchState.mediaPublicId) params.set('media', searchState.mediaPublicId);
      const qs = params.toString();
      return qs ? `${BOT_CONFIG.frontendUrl}/search?${qs}` : `${BOT_CONFIG.frontendUrl}/search`;
    };

    const cleanupModal = setupModalListener(
      interaction.client,
      interaction.user.id,
      searchState,
      display,
      getMediaUrl,
      [rerollButton],
      filterState,
    );

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'media_select') {
        await i.deferUpdate();

        const mediaPublicId = i.values[0];
        searchState.mediaPublicId = mediaPublicId;
        const selected = media.find((m) => m.mediaPublicId === mediaPublicId);
        searchState.mediaName = getMediaName(selected);

        const randomResult = await fetchRandom(mediaPublicId);

        if (randomResult.segments.length === 0) {
          await i.followUp({ content: `No sentences found in **${searchState.mediaName}**.`, ephemeral: true });
          return;
        }

        currentSegment = randomResult.segments[0];
        currentMedia = randomResult.includes.media[currentSegment.mediaPublicId];
        searchState.results = null;
        contextState.viewingContext = false;

        await updateSegmentReply(i, currentSegment, currentMedia, display, getMediaUrl(), randomButtons);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'search_select' && searchState.results) {
        await i.deferUpdate();
        const idx = searchState.results.segments.findIndex((s) => s.segmentPublicId === i.values[0]);
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
        handleFilterMediaSelect(i, searchState, filterState);

        if (!searchState.mediaPublicId) return;

        const newResult = await fetchRandom(searchState.mediaPublicId);
        if (newResult.segments.length === 0) {
          await i.followUp({ content: `No sentences found in **${searchState.mediaName}**.`, ephemeral: true });
          return;
        }

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];
        contextState.viewingContext = false;
        searchState.results = null;

        await updateSegmentReply(i, currentSegment, currentMedia, display, getMediaUrl(), randomButtons);
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
          await handleBackToOriginal(i, display, contextState, getMediaUrl(), randomButtons);
        }
        return;
      }

      if (i.customId === 'reroll' && searchState.mediaPublicId) {
        await i.deferUpdate();
        contextState.viewingContext = false;
        searchState.results = null;

        const newResult = await fetchRandom(searchState.mediaPublicId);
        if (newResult.segments.length === 0) return;

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];

        await updateSegmentReply(i, currentSegment, currentMedia, display, getMediaUrl(), randomButtons);
        return;
      }

      if (i.customId === 'advanced_search' && searchState.mediaPublicId) {
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
          await updateSegmentReply(i, currentSegment, currentMedia, display, getMediaUrl(), randomButtons);
        }
        return;
      }

      if (i.customId === 'filter_media_first') {
        await i.deferUpdate();
        filterState.mediaPage = 0;
        await renderFilterMediaPage(i, searchState, filterState);
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
        return;
      }

      if (i.customId === 'filter_media_last') {
        await i.deferUpdate();
        const totalPages = Math.ceil(filterState.filteredMedia.length / MEDIA_PER_PAGE);
        filterState.mediaPage = Math.max(0, totalPages - 1);
        await renderFilterMediaPage(i, searchState, filterState);
        return;
      }

      if (i.customId === 'filter_media_search') {
        await showFilterMediaSearchModal(i);
      }
    });

    collector.on('end', async () => {
      cleanupModal();
      try {
        if (currentSegment) {
          await interaction.editReply({ components: [buildLinkOnlyRow(getMediaUrl())] });
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
