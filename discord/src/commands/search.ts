import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { search } from '../api';
import type { DisplayOptions } from '../embeds';
import { buildLinkOnlyRow, createContextState, handleContextButton, handleContextSelect } from '../segmentReply';
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
  resetPages,
  goToFirstPage,
  goToNextPage,
  goToPrevPage,
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
    opt.setName('query').setDescription('Search query (Japanese, English, or romaji)').setRequired(true),
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
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  const exact = interaction.options.getBoolean('exact') ?? false;
  const category = interaction.options.getString('category');
  const mediaId = interaction.options.getString('media') ?? undefined;

  const settings = getGuildSettings(interaction.guildId);
  const display: DisplayOptions = {
    language: (interaction.options.getString('language') as Language) ?? settings.language,
  };

  try {
    const result = await search(query, {
      exactMatch: exact,
      take: BOT_CONFIG.maxSearchResults,
      category: category ?? undefined,
      mediaId,
    });

    if (result.segments.length === 0) {
      const searchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(query)}`;
      await interaction.editReply({
        content: `No results found for **${query}** -- [Search on Nadeshiko](<${searchUrl}>)`,
      });
      return;
    }

    const searchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(query)}`;
    const contextState = createContextState();
    const searchState = createSearchModalState(mediaId);
    const filterState = createFilterMediaState();

    searchState.lastQuery = query;
    searchState.lastSearchOptions = { exactMatch: exact || undefined, category: category ?? undefined };
    resetPages(searchState, result);

    const searchExtraButtons = [advancedSearchButton, filterMediaButton];

    const cleanupModal = setupModalListener(
      interaction.client,
      interaction.user.id,
      searchState,
      display,
      () => `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`,
      searchExtraButtons,
    );
    await renderSearchResult(interaction, searchState, display, searchUrl, searchExtraButtons);
    const reply = await interaction.fetchReply();

    const collector = reply.createMessageComponentCollector({ time: 300_000 });

    collector.on('collect', async (i) => {
      if (i.isStringSelectMenu() && i.customId === 'context_select') {
        await handleContextSelect(i, display, contextState);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'filter_media_select') {
        await i.deferUpdate();
        handleFilterMediaSelect(i, searchState);

        const newQuery = searchState.lastQuery || '*';
        const newResult = await search(newQuery, {
          take: BOT_CONFIG.maxSearchResults,
          mediaId: searchState.mediaId,
          ...searchState.lastSearchOptions,
        });

        if (newResult.segments.length === 0) {
          await i.followUp({ content: `No results found in **${searchState.mediaName}**.`, ephemeral: true });
          return;
        }

        resetPages(searchState, newResult);
        contextState.viewingContext = false;

        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'search_select' && searchState.results) {
        await i.deferUpdate();

        const selectedId = i.values[0];
        const newIndex = searchState.results.segments.findIndex((s) => s.publicId === selectedId);
        if (newIndex === -1) return;

        searchState.currentIndex = newIndex;
        contextState.viewingContext = false;

        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (!i.isButton()) return;

      if (i.customId === 'next_page' && searchState.results) {
        await i.deferUpdate();
        const ok = await goToNextPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (i.customId === 'prev_page' && searchState.results) {
        await i.deferUpdate();
        const ok = goToPrevPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (i.customId === 'first_page' && searchState.results) {
        await i.deferUpdate();
        const ok = goToFirstPage(searchState);
        if (!ok) return;
        contextState.viewingContext = false;
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
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

        // Inject the random result as the current viewed segment
        searchState.results.segments[searchState.currentIndex] = seg;
        searchState.results.includes.media[seg.mediaPublicId] = media;

        contextState.viewingContext = false;
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (i.customId === 'context' && searchState.results) {
        const seg = searchState.results.segments[searchState.currentIndex];
        const media = searchState.results.includes.media[seg.mediaPublicId];
        await handleContextButton(i, seg, media, display, contextState, [advancedSearchButton]);
        return;
      }

      if (i.customId === 'back_to_original' && searchState.results) {
        await i.deferUpdate();
        contextState.viewingContext = false;
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
        return;
      }

      if (i.customId === 'advanced_search') {
        await showSearchModal(i, 'Refine search', { query: searchState.lastQuery });
        return;
      }

      if (i.customId === 'filter_media') {
        await showFilterMediaSelect(i, searchState, filterState);
        return;
      }

      if (i.customId === 'cancel_filter_media' && searchState.results) {
        await i.deferUpdate();
        const curSearchUrl = `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(searchState.lastQuery)}`;
        await renderSearchResult(i, searchState, display, curSearchUrl, searchExtraButtons);
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
        const idx = searchState.currentIndex;
        const segments = searchState.results?.segments;
        if (segments?.[idx]) {
          await interaction.editReply({ components: [buildLinkOnlyRow(segments[idx].publicId)] });
        } else {
          await interaction.editReply({ components: [] });
        }
      } catch {}
    });
  } catch (error) {
    const traceId = getActiveTraceId();
    log.error({ err: error, traceId }, 'Search command failed');
    const suffix = traceId ? ` (trace: ${traceId})` : '';
    await interaction.editReply({ content: `Something went wrong.${suffix}` });
  }
}
