import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { search } from '../api';
import type { DisplayOptions } from '../embeds';
import {
  renderSegmentReply,
  updateSegmentReply,
  createContextState,
  handleContextButton,
  handleContextSelect,
  handleBackToOriginal,
  buildLinkOnlyRow,
} from '../segmentReply';
import {
  advancedSearchButton,
  filterMediaButton,
  createSearchModalState,
  showSearchModal,
  showFilterMediaSelect,
  handleFilterMediaSelect,
  createFilterMediaState,
  renderFilterMediaPage,
  renderSearchResult,
  setupModalListener,
  goToFirstPage,
  goToNextPage,
  goToPrevPage,
} from '../searchModal';
import { BOT_CONFIG } from '../config';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';
import { getGuildSettings, type Language } from '../settings';

const log = createLogger('cmd:random');

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Get a random Japanese sentence')
  .addStringOption((opt) =>
    opt
      .setName('language')
      .setDescription('Override translation language')
      .setRequired(false)
      .addChoices(
        { name: 'English', value: 'en' },
        { name: 'Spanish', value: 'es' },
        { name: 'Both', value: 'both' },
        { name: 'None', value: 'none' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('media')
      .setDescription('Filter by anime/drama (type to search)')
      .setRequired(false)
      .setAutocomplete(true),
  );

const rerollButton = new ButtonBuilder()
  .setCustomId('reroll')
  .setLabel('Another one')
  .setStyle(ButtonStyle.Primary)
  .setEmoji('🎲');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const settings = getGuildSettings(interaction.guildId);
  const display: DisplayOptions = {
    language: (interaction.options.getString('language') as Language) ?? settings.language,
  };
  const mediaId = interaction.options.getString('media') ?? undefined;

  try {
    const result = await fetchRandom(mediaId);

    if (result.segments.length === 0) {
      await interaction.editReply({ content: 'No results found.' });
      return;
    }

    let currentSegment = result.segments[0];
    let currentMedia = result.includes.media[currentSegment.mediaPublicId];
    const contextState = createContextState();
    const searchState = createSearchModalState(mediaId);
    const filterState = createFilterMediaState();
    const searchUrl = `${BOT_CONFIG.frontendUrl}/search`;
    const randomButtons = [rerollButton, advancedSearchButton, filterMediaButton];

    const reply = await renderSegmentReply({
      interaction,
      segment: currentSegment,
      media: currentMedia,
      display,
      extraButtons: randomButtons,
    });

    const cleanupModal = setupModalListener(interaction.client, interaction.user.id, searchState, display, searchUrl, [
      rerollButton,
    ]);

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'filter_media_select') {
        await i.deferUpdate();
        handleFilterMediaSelect(i, searchState);

        const newResult = await fetchRandom(searchState.mediaId);
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

      if (i.isStringSelectMenu() && i.customId === 'search_select' && searchState.results) {
        await i.deferUpdate();
        const idx = searchState.results.segments.findIndex((s) => s.publicId === i.values[0]);
        if (idx === -1) return;
        searchState.currentIndex = idx;
        contextState.viewingContext = false;

        const seg = searchState.results.segments[idx];
        const media = searchState.results.includes.media[seg.mediaPublicId];
        currentSegment = seg;
        currentMedia = media;

        await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'next_page' && searchState.results) {
        await i.deferUpdate();
        const ok = await goToNextPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        return;
      }

      if (i.customId === 'prev_page' && searchState.results) {
        await i.deferUpdate();
        const ok = goToPrevPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        return;
      }

      if (i.customId === 'first_page' && searchState.results) {
        await i.deferUpdate();
        const ok = goToFirstPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        return;
      }

      if (i.customId === 'random_result' && searchState.results) {
        await i.deferUpdate();
        const randomResult = await search(searchState.lastQuery, {
          take: 1,
          sort: 'RANDOM',
          seed: Math.floor(Math.random() * 1_000_000),
          mediaId: searchState.mediaId,
          ...searchState.lastSearchOptions,
        });
        if (randomResult.segments.length === 0) return;

        const seg = randomResult.segments[0];
        const media = randomResult.includes.media[seg.mediaPublicId];
        searchState.results.segments[searchState.currentIndex] = seg;
        searchState.results.includes.media[seg.mediaPublicId] = media;
        currentSegment = seg;
        currentMedia = media;
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        return;
      }

      if (i.customId === 'context') {
        const extraBtns = searchState.results ? [advancedSearchButton] : randomButtons;
        await handleContextButton(i, currentSegment, currentMedia, display, contextState, extraBtns);
        return;
      }

      if (i.customId === 'back_to_original') {
        if (searchState.results) {
          await i.deferUpdate();
          contextState.viewingContext = false;
          await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        } else {
          await handleBackToOriginal(i, display, contextState, randomButtons);
        }
        return;
      }

      if (i.customId === 'reroll') {
        await i.deferUpdate();
        const newResult = await fetchRandom(searchState.mediaId);
        if (newResult.segments.length === 0) return;

        currentSegment = newResult.segments[0];
        currentMedia = newResult.includes.media[currentSegment.mediaPublicId];
        contextState.viewingContext = false;
        searchState.results = null;

        await updateSegmentReply(i, currentSegment, currentMedia, display, randomButtons);
        return;
      }

      if (i.customId === 'advanced_search') {
        await showSearchModal(i, 'Search sentences');
        return;
      }

      if (i.customId === 'filter_media') {
        await showFilterMediaSelect(i, searchState, filterState);
        return;
      }

      if (i.customId === 'cancel_filter_media') {
        await i.deferUpdate();
        if (searchState.results) {
          await renderSearchResult(i, searchState, display, searchUrl, [rerollButton]);
        } else {
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
        return;
      }
    });

    collector.on('end', async () => {
      cleanupModal();
      try {
        await interaction.editReply({ components: [buildLinkOnlyRow(currentSegment.publicId)] });
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Random command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}

function fetchRandom(mediaId?: string) {
  return search('*', {
    take: 1,
    sort: 'RANDOM',
    seed: Math.floor(Math.random() * 1_000_000),
    mediaId,
  });
}
