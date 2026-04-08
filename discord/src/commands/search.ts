import { SlashCommandBuilder, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import { search, fetchRandom, getSearchStats } from '../api';
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
  randomResultButton,
  createSearchModalState,
  showSearchModal,
  showFilterMediaSelect,
  showFilterMediaSearchModal,
  handleFilterMediaSelect,
  createFilterMediaState,
  renderFilterMediaPage,
  renderSearchResult,
  setupModalListener,
  resetPages,
  MEDIA_PER_PAGE,
  goToFirstPage,
  goToNextPage,
  goToPrevPage,
  goToSkipBack,
  goToSkipForward,
} from '../searchModal';
import { BOT_CONFIG } from '../config';
import { createLogger } from '../logger';
import { getActiveTraceId } from '../instrumentation';
import { getGuildSettings, type Language } from '../settings';

const log = createLogger('cmd:search');

export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search for Japanese sentences in anime and drama')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('Search query (Japanese, English, or romaji)').setRequired(false),
  )
  .addBooleanOption((opt) => opt.setName('exact').setDescription('Exact phrase match').setRequired(false))
  .addStringOption((opt) =>
    opt
      .setName('media')
      .setDescription('Filter by anime/drama (type to search)')
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('category')
      .setDescription('Filter by category')
      .setRequired(false)
      .addChoices({ name: 'Anime', value: 'ANIME' }, { name: 'J-Drama', value: 'JDRAMA' }),
  )
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
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const settings = getGuildSettings(interaction.guildId);
  await executeSearch(interaction, {
    query: interaction.options.getString('query') ?? undefined,
    exact: interaction.options.getBoolean('exact') ?? false,
    category: interaction.options.getString('category') ?? undefined,
    mediaId: interaction.options.getString('media') ?? undefined,
    display: {
      language: (interaction.options.getString('language') as Language) ?? settings.language,
    },
  });
}

export type SearchParams = {
  query?: string;
  exact?: boolean;
  category?: string;
  mediaId?: string;
  episodes?: number[];
  display: DisplayOptions;
};

export async function executeSearch(interaction: ChatInputCommandInteraction | ButtonInteraction, params: SearchParams) {
  await interaction.deferReply();

  const { query, exact, category, mediaId, episodes, display } = params;
  const isRandomMode = !query;
  const searchQuery = query || '';

  try {
    let result;

    let cachedSearchStats: Awaited<ReturnType<typeof getSearchStats>> | null = null;
    if (isRandomMode) {
      const [randomResult, searchStats] = await Promise.all([fetchRandom(mediaId, episodes), getSearchStats()]);
      result = randomResult;
      cachedSearchStats = searchStats;
    } else {
      result = await search(searchQuery, {
        exactMatch: exact || undefined,
        take: BOT_CONFIG.maxSearchResults,
        category,
        mediaId,
        episodes,
      });
    }

    if (result.segments.length === 0) {
      if (isRandomMode) {
        await interaction.editReply({ content: 'No results found.' });
      } else {
        const url = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchQuery)}`;
        await interaction.editReply({
          content: `No results found for \`${searchQuery}\` -- [Search on Nadeshiko](<${url}>)`,
        });
      }
      return;
    }

    let currentSegment = result.segments[0];
    let currentMedia = result.includes.media[currentSegment.mediaPublicId];

    const contextState = createContextState();
    const searchState = createSearchModalState(mediaId);
    const filterState = createFilterMediaState();
    filterState.cachedSearchStats = cachedSearchStats;

    const actionButtons = [advancedSearchButton, randomResultButton, filterMediaButton];

    const buildSearchUrl = () => {
      const q = searchState.lastQuery;
      const base = q
        ? `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(q)}`
        : `${BOT_CONFIG.frontendUrl}/search`;
      const params = new URLSearchParams();
      if (searchState.mediaId) params.set('media', searchState.mediaId);
      const eps = searchState.lastSearchOptions.episodes;
      if (eps?.length) params.set('episode', eps.join(','));
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    };

    const syncCurrentSegment = () => {
      if (!searchState.results) return;
      const seg = searchState.results.segments[searchState.currentIndex];
      currentSegment = seg;
      currentMedia = searchState.results.includes.media[seg.mediaPublicId];
    };

    const buildStatsPrefix = () => {
      const stats = filterState.cachedSearchStats;
      if (!stats) return undefined;
      if (searchState.mediaId) {
        const mediaStat = stats.media.find((m) => m.publicId === searchState.mediaId);
        const count = mediaStat?.matchCount ?? 0;
        const name = searchState.mediaName ?? 'Unknown';
        return `🔎 Searching from **${count.toLocaleString()}** sentences in **${name}**`;
      }
      const total = stats.media.reduce((sum, m) => sum + m.matchCount, 0);
      return `🔎 Searching from **${total.toLocaleString()}** sentences on Nadeshiko`;
    };

    let reply;
    if (isRandomMode) {
      reply = await renderSegmentReply({
        interaction,
        segment: currentSegment,
        media: currentMedia,
        display,
        linkUrl: buildSearchUrl(),
        extraButtons: actionButtons,
        contentPrefix: buildStatsPrefix(),
      });
    } else {
      searchState.lastQuery = searchQuery;
      searchState.lastSearchOptions = { exactMatch: exact || undefined, category };
      resetPages(searchState, result);
      await renderSearchResult(interaction, searchState, display, buildSearchUrl(), actionButtons);
      reply = await interaction.fetchReply();
    }

    const cleanupModal = setupModalListener(
      interaction.client,
      interaction.user.id,
      searchState,
      display,
      buildSearchUrl,
      actionButtons,
      filterState,
    );

    const collector = reply.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'filter_media_select') {
        await i.deferUpdate();
        handleFilterMediaSelect(i, searchState, filterState);
        filterState.allMedia = [];
        filterState.filteredMedia = [];
        filterState.nameFilter = '';

        if (isRandomMode && !searchState.results) {
          const newResult = await fetchRandom(searchState.mediaId);
          if (newResult.segments.length === 0) {
            await i.followUp({ content: `No sentences found in **${searchState.mediaName}**.` });
            return;
          }
          currentSegment = newResult.segments[0];
          currentMedia = newResult.includes.media[currentSegment.mediaPublicId];
          contextState.viewingContext = false;
          await updateSegmentReply(i, currentSegment, currentMedia, display, buildSearchUrl(), actionButtons, buildStatsPrefix());
        } else {
          const newQuery = searchState.lastQuery;
          const newResult = await search(newQuery, {
            take: BOT_CONFIG.maxSearchResults,
            mediaId: searchState.mediaId,
            ...searchState.lastSearchOptions,
          });
          if (newResult.segments.length === 0) {
            await i.followUp({ content: `No results found in **${searchState.mediaName}**.` });
            return;
          }
          resetPages(searchState, newResult);
          syncCurrentSegment();
          contextState.viewingContext = false;
          await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        }
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'search_select' && searchState.results) {
        await i.deferUpdate();
        const idx = searchState.results.segments.findIndex((s) => s.publicId === i.values[0]);
        if (idx === -1) return;
        searchState.currentIndex = idx;
        syncCurrentSegment();
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        return;
      }

      if (!i.isButton()) return;

      const paginationHandler: Record<string, () => boolean | Promise<boolean>> = {
        next_page: () => goToNextPage(searchState),
        prev_page: () => goToPrevPage(searchState),
        first_page: () => goToFirstPage(searchState),
        skip_back: () => goToSkipBack(searchState),
        skip_forward: () => goToSkipForward(searchState),
      };

      if (i.customId in paginationHandler && searchState.results) {
        await i.deferUpdate();
        const ok = await paginationHandler[i.customId]();
        if (!ok) return;
        syncCurrentSegment();
        contextState.viewingContext = false;
        await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        return;
      }

      if (i.customId === 'random_result') {
        await i.deferUpdate();
        if (searchState.results) {
          const segments = searchState.results.segments;
          if (segments.length <= 1) {
            const ok = await goToNextPage(searchState);
            if (!ok) return;
          }
          const candidates = searchState.results.segments
            .map((_, idx) => idx)
            .filter((idx) => idx !== searchState.currentIndex);
          if (candidates.length === 0) return;
          searchState.currentIndex = candidates[Math.floor(Math.random() * candidates.length)];
          syncCurrentSegment();
          contextState.viewingContext = false;
          await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        } else {
          const newResult = await fetchRandom(searchState.mediaId);
          if (newResult.segments.length === 0) return;
          currentSegment = newResult.segments[0];
          currentMedia = newResult.includes.media[currentSegment.mediaPublicId];
          contextState.viewingContext = false;
          await updateSegmentReply(i, currentSegment, currentMedia, display, buildSearchUrl(), actionButtons, buildStatsPrefix());
        }
        return;
      }

      if (i.customId === 'context') {
        await handleContextButton(i, currentSegment, currentMedia, display, contextState, actionButtons);
        return;
      }

      if (i.customId === 'back_to_original') {
        if (searchState.results) {
          await i.deferUpdate();
          contextState.viewingContext = false;
          await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        } else {
          await handleBackToOriginal(i, display, contextState, buildSearchUrl(), actionButtons, buildStatsPrefix());
        }
        return;
      }

      if (i.customId === 'advanced_search') {
        const title = isRandomMode ? 'Search sentences' : 'Refine search';
        const opts = searchState.lastSearchOptions;
        const defaults = {
          query: searchState.lastQuery || undefined,
          episodes: opts.episodes?.join(', '),
          sort: opts.sort,
        };
        await showSearchModal(i, title, defaults);
        return;
      }

      if (i.customId === 'filter_media') {
        await showFilterMediaSelect(i, searchState, filterState);
        return;
      }

      if (i.customId === 'cancel_filter_media') {
        await i.deferUpdate();
        if (searchState.results) {
          await renderSearchResult(i, searchState, display, buildSearchUrl(), actionButtons);
        } else {
          await updateSegmentReply(i, currentSegment, currentMedia, display, buildSearchUrl(), actionButtons, buildStatsPrefix());
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
        await interaction.editReply({ components: [buildLinkOnlyRow(buildSearchUrl())] });
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Search command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}

