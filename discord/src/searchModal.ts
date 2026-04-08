import {
  ModalBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type Client,
} from 'discord.js';
import { search, getSearchStats } from './api';
import type { SearchResponse, SearchStatsResponse } from './api';
import { buildSegmentMessage, getMediaName, type DisplayOptions } from './embeds';
import { buildSearchSelectComponents, loadVideoFiles } from './segmentReply';
import { findMediaByPublicId } from './mediaCache';
import { BOT_CONFIG } from './config';
import { createLogger } from './logger';

const log = createLogger('searchModal');

export const advancedSearchButton = new ButtonBuilder()
  .setCustomId('advanced_search')
  .setLabel('Search')
  .setStyle(ButtonStyle.Secondary)
  .setEmoji('🔍');

export const filterMediaButton = new ButtonBuilder()
  .setCustomId('filter_media')
  .setLabel('Filter media')
  .setStyle(ButtonStyle.Secondary)
  .setEmoji('🎬');

export type SearchModalState = {
  results: SearchResponse | null;
  currentIndex: number;
  mediaId: string | undefined;
  mediaName: string | undefined;
  lastQuery: string;
  pages: SearchResponse[];
  currentPage: number;
  lastSearchOptions: {
    exactMatch?: boolean;
    category?: string;
    episodes?: number[];
    sort?: string;
  };
};

export const firstPageButton = new ButtonBuilder()
  .setCustomId('first_page')
  .setEmoji('⏮')
  .setStyle(ButtonStyle.Secondary)
  .setDisabled(true);

export const skipBackButton = new ButtonBuilder()
  .setCustomId('skip_back')
  .setEmoji('⏪')
  .setStyle(ButtonStyle.Secondary)
  .setDisabled(true);

export const prevPageButton = new ButtonBuilder()
  .setCustomId('prev_page')
  .setEmoji('◀')
  .setStyle(ButtonStyle.Secondary)
  .setDisabled(true);

export const nextPageButton = new ButtonBuilder()
  .setCustomId('next_page')
  .setEmoji('▶')
  .setStyle(ButtonStyle.Secondary);

export const skipForwardButton = new ButtonBuilder()
  .setCustomId('skip_forward')
  .setEmoji('⏩')
  .setStyle(ButtonStyle.Secondary);

export const randomResultButton = new ButtonBuilder()
  .setCustomId('random_result')
  .setLabel('Random')
  .setStyle(ButtonStyle.Secondary)
  .setEmoji('🎲');

export function createSearchModalState(mediaId?: string): SearchModalState {
  const mediaItem = mediaId ? findMediaByPublicId(mediaId) : undefined;
  return {
    results: null,
    currentIndex: 0,
    mediaId,
    mediaName: mediaItem ? getMediaName(mediaItem) : undefined,
    lastQuery: '',
    pages: [],
    currentPage: 0,
    lastSearchOptions: {},
  };
}

export function resetPages(state: SearchModalState, results: SearchResponse) {
  state.pages = [results];
  state.currentPage = 0;
  state.currentIndex = 0;
  state.results = results;
}

export async function goToNextPage(state: SearchModalState): Promise<boolean> {
  if (!state.results?.pagination.hasMore) return false;

  const nextPage = state.currentPage + 1;

  if (state.pages[nextPage]) {
    state.currentPage = nextPage;
    state.results = state.pages[nextPage];
    state.currentIndex = 0;
    return true;
  }

  const cursor = state.results.pagination.cursor;
  if (!cursor) return false;

  const newResults = await search(state.lastQuery, {
    take: BOT_CONFIG.maxSearchResults,
    cursor,
    mediaId: state.mediaId,
    exactMatch: state.lastSearchOptions.exactMatch,
    category: state.lastSearchOptions.category,
    episodes: state.lastSearchOptions.episodes,
    sort: state.lastSearchOptions.sort,
  });

  if (newResults.segments.length === 0) return false;

  state.pages[nextPage] = newResults;
  state.currentPage = nextPage;
  state.results = newResults;
  state.currentIndex = 0;
  return true;
}

export function goToFirstPage(state: SearchModalState): boolean {
  if (state.currentPage === 0) return false;
  state.currentPage = 0;
  state.results = state.pages[0];
  state.currentIndex = 0;
  return true;
}

export function goToPrevPage(state: SearchModalState): boolean {
  if (state.currentPage === 0) return false;

  state.currentPage--;
  state.results = state.pages[state.currentPage];
  state.currentIndex = 0;
  return true;
}

export function goToSkipBack(state: SearchModalState, count = 10): boolean {
  if (state.currentPage === 0) return false;
  state.currentPage = Math.max(0, state.currentPage - count);
  state.results = state.pages[state.currentPage];
  state.currentIndex = 0;
  return true;
}

export async function goToSkipForward(state: SearchModalState, count = 10): Promise<boolean> {
  let moved = false;
  for (let i = 0; i < count; i++) {
    const ok = await goToNextPage(state);
    if (!ok) break;
    moved = true;
  }
  return moved;
}

export function buildPaginationButtons(state: SearchModalState): ButtonBuilder[] {
  const atFirst = state.currentPage === 0;
  const hasMore = (state.results?.pagination.hasMore ?? false)
    && (state.results?.segments.length ?? 0) >= BOT_CONFIG.maxSearchResults;
  const first = ButtonBuilder.from(firstPageButton.toJSON()).setDisabled(atFirst);
  const skipBack = ButtonBuilder.from(skipBackButton.toJSON()).setDisabled(atFirst);
  const prev = ButtonBuilder.from(prevPageButton.toJSON()).setDisabled(atFirst);
  const next = ButtonBuilder.from(nextPageButton.toJSON()).setDisabled(!hasMore);
  const skipFwd = ButtonBuilder.from(skipForwardButton.toJSON()).setDisabled(!hasMore);
  return [first, skipBack, prev, next, skipFwd];
}

export function getPageOffset(state: SearchModalState): number {
  return state.currentPage * BOT_CONFIG.maxSearchResults;
}

export function showSearchModal(btnInteraction: ButtonInteraction, title: string, defaults?: { query?: string; episodes?: string; sort?: string }) {
  const modal = new ModalBuilder().setCustomId('advanced_search_modal').setTitle(title.slice(0, 45));

  const queryInput = new TextInputBuilder()
    .setCustomId('search_query')
    .setLabel('Search query')
    .setPlaceholder('Japanese, English or Spanish word (use "" for exact match)')
    .setStyle(TextInputStyle.Short)
    .setValue(defaults?.query ?? '')
    .setRequired(false);

  const episodeInput = new TextInputBuilder()
    .setCustomId('search_episodes')
    .setLabel('Episode(s)')
    .setPlaceholder('e.g. 1, 3-5, 12')
    .setStyle(TextInputStyle.Short)
    .setValue(defaults?.episodes ?? '')
    .setRequired(false);

  const sortInput = new TextInputBuilder()
    .setCustomId('search_sort')
    .setLabel('Sort')
    .setPlaceholder('asc, desc, time_asc, time_desc, or random')
    .setStyle(TextInputStyle.Short)
    .setValue(defaults?.sort ?? '')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(queryInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(episodeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(sortInput),
  );

  return btnInteraction.showModal(modal);
}

function parseEpisodes(input: string): number[] | undefined {
  if (!input.trim()) return undefined;
  const episodes: number[] = [];
  for (const part of input.split(',')) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      for (let i = start; i <= end; i++) episodes.push(i);
    } else {
      const num = Number.parseInt(part.trim(), 10);
      if (!Number.isNaN(num)) episodes.push(num);
    }
  }
  return episodes.length > 0 ? episodes : undefined;
}

export async function handleModalSubmit(
  modalInteraction: ModalSubmitInteraction,
  state: SearchModalState,
  display: DisplayOptions,
  linkUrl: string | (() => string),
  extraButtons?: ButtonBuilder[],
): Promise<boolean> {
  await modalInteraction.deferUpdate();

  const searchQuery = modalInteraction.fields.getTextInputValue('search_query').trim();
  const episodesRaw = modalInteraction.fields.getTextInputValue('search_episodes').trim();
  const sortRaw = modalInteraction.fields.getTextInputValue('search_sort').trim().toLowerCase();

  const episodes = parseEpisodes(episodesRaw);
  const sort = ['asc', 'desc', 'time_asc', 'time_desc', 'random'].includes(sortRaw) ? sortRaw : undefined;

  state.lastSearchOptions = { episodes, sort };

  const searchResult = await search(searchQuery, {
    take: BOT_CONFIG.maxSearchResults,
    mediaId: state.mediaId,
    episodes,
    sort,
  });

  if (searchResult.segments.length === 0) {
    const parts = [`No results found for \`${searchQuery}\``];
    if (state.mediaName) parts.push(`in **${state.mediaName}**`);
    if (episodes?.length) parts.push(`(episode ${episodes.join(', ')})`);
    await modalInteraction.followUp({ content: `${parts.join(' ')}.` });
    return false;
  }

  state.lastQuery = searchQuery;
  resetPages(state, searchResult);

  const resolvedUrl = typeof linkUrl === 'function' ? linkUrl() : linkUrl;
  await renderSearchResult(modalInteraction, state, display, resolvedUrl, extraButtons);
  return true;
}

export async function renderSearchResult(
  interaction: { editReply: ModalSubmitInteraction['editReply'] },
  state: SearchModalState,
  display: DisplayOptions,
  linkUrl: string,
  extraButtons?: ButtonBuilder[],
) {
  if (!state.results) return;

  const seg = state.results.segments[state.currentIndex];
  const media = state.results.includes.media[seg.mediaPublicId];
  const segContent = buildSegmentMessage(seg, media, display);
  const pageOffset = getPageOffset(state);
  const total = state.results.pagination.estimatedTotalHits;
  const totalPages = Math.ceil(total / BOT_CONFIG.maxSearchResults);
  const pageLabel = totalPages > 1 ? ` [Page ${state.currentPage + 1} of ${totalPages}]` : '';
  const isWildcard = !state.lastQuery;
  const queryLabel = isWildcard ? '' : ` for \`${state.lastQuery}\``;
  const eps = state.lastSearchOptions.episodes;
  const episodeLabel = eps?.length ? ` Ep. ${eps.join(', ')}` : '';
  const mediaLabel = state.mediaName ? ` in **${state.mediaName}${episodeLabel}**` : '';
  const paginationButtons = buildPaginationButtons(state);
  const buttons = [...paginationButtons, ...(extraButtons ?? [])];
  const components = buildSearchSelectComponents(
    state.results.segments,
    state.results.includes.media,
    seg.publicId,
    linkUrl,
    buttons,
    pageOffset,
  );

  const files = await loadVideoFiles(seg);
  const content = `🔎 **~${total.toLocaleString()} results**${queryLabel}${mediaLabel}${pageLabel}\n\n${segContent}`;

  await interaction.editReply({ content, components, files });
}

export const MEDIA_PER_PAGE = 24;


export type FilterMediaItem = {
  publicId: string;
  name: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
  matchCount: number;
};

export type FilterMediaState = {
  mediaPage: number;
  allMedia: FilterMediaItem[];
  filteredMedia: FilterMediaItem[];
  nameFilter: string;
  cachedSearchStats: SearchStatsResponse | null;
};

export function createFilterMediaState(): FilterMediaState {
  return { mediaPage: 0, allMedia: [], filteredMedia: [], nameFilter: '', cachedSearchStats: null };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function mediaMatchesFilter(m: FilterMediaItem, filter: string): boolean {
  const norm = normalize(filter);
  if (!norm) return true;
  return [m.name, m.nameEn, m.nameJa, m.nameRomaji].some((n) => n && normalize(n).includes(norm));
}

export async function showFilterMediaSelect(
  btnInteraction: ButtonInteraction,
  state: SearchModalState,
  filterState: FilterMediaState,
) {
  await btnInteraction.deferUpdate();

  const stats = filterState.cachedSearchStats
    ?? await getSearchStats(
      state.lastQuery || undefined,
      state.lastSearchOptions,
    );
  filterState.cachedSearchStats = stats;
  filterState.allMedia = stats.media.map((m) => {
    const media = stats.includes.media[m.publicId];
    return {
      publicId: m.publicId,
      name: getMediaName(media),
      nameEn: media?.nameEn ?? undefined,
      nameJa: media?.nameJa ?? undefined,
      nameRomaji: media?.nameRomaji ?? undefined,
      matchCount: m.matchCount,
    };
  });
  filterState.allMedia.sort((a, b) => a.name.localeCompare(b.name));
  filterState.nameFilter = '';
  filterState.filteredMedia = filterState.allMedia;

  if (state.mediaId) {
    const idx = filterState.filteredMedia.findIndex((m) => m.publicId === state.mediaId);
    filterState.mediaPage = idx >= 0 ? Math.floor(idx / MEDIA_PER_PAGE) : 0;
  } else {
    filterState.mediaPage = 0;
  }

  await renderFilterMediaPage(btnInteraction, state, filterState);
}

export async function renderFilterMediaPage(
  interaction: { editReply: ButtonInteraction['editReply'] },
  state: SearchModalState,
  filterState: FilterMediaState,
) {
  const { filteredMedia, mediaPage } = filterState;
  const totalPages = Math.ceil(filteredMedia.length / MEDIA_PER_PAGE);
  const start = mediaPage * MEDIA_PER_PAGE;
  const pageMedia = filteredMedia.slice(start, start + MEDIA_PER_PAGE);

  const list = pageMedia
    .map((m, i) => {
      const num = start + i + 1;
      return `${num}) ${m.name} - ${m.matchCount.toLocaleString()} sentences`;
    })
    .join('\n');

  const pageLabel = totalPages > 1 ? ` [Page ${mediaPage + 1} of ${totalPages}]` : '';
  const filterLabel = filterState.nameFilter ? ` - filtering by "${filterState.nameFilter}"` : '';
  const header = `🎬 **Filter by media**${pageLabel}${filterLabel}\n\n${list}`;

  const options = pageMedia.map((m, i) => {
    const parts = [m.nameJa, `${m.matchCount.toLocaleString()} sentences`].filter(Boolean);
    return {
      label: `${start + i + 1}) ${m.name}`.slice(0, 100),
      value: m.publicId,
      description: parts.join(' - ').slice(0, 100),
      default: m.publicId === state.mediaId,
    };
  });

  options.unshift({
    label: 'All media (no filter)',
    value: '__all__',
    description: 'Remove media filter',
    default: !state.mediaId,
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('filter_media_select')
    .setPlaceholder('Filter by media...')
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const actionButtons = [
    new ButtonBuilder().setCustomId('filter_media_search').setLabel('Filter by name').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cancel_filter_media').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  ];
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons);

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [selectRow];

  if (totalPages > 1) {
    const paginationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('filter_media_first').setEmoji('⏮').setStyle(ButtonStyle.Secondary).setDisabled(mediaPage === 0),
      new ButtonBuilder().setCustomId('filter_media_prev').setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(mediaPage === 0),
      new ButtonBuilder().setCustomId('filter_media_next').setEmoji('▶').setStyle(ButtonStyle.Secondary).setDisabled(mediaPage >= totalPages - 1),
      new ButtonBuilder().setCustomId('filter_media_last').setEmoji('⏭').setStyle(ButtonStyle.Secondary).setDisabled(mediaPage >= totalPages - 1),
    );
    components.push(paginationRow);
  }

  components.push(actionRow);

  await interaction.editReply({
    content: header,
    components,
    files: [],
  });
}

export function handleFilterMediaSelect(
  selectInteraction: StringSelectMenuInteraction,
  state: SearchModalState,
  filterState: FilterMediaState,
): void {
  const value = selectInteraction.values[0];

  if (value === '__all__') {
    state.mediaId = undefined;
    state.mediaName = undefined;
  } else {
    state.mediaId = value;
    const filterItem = filterState.allMedia.find((m) => m.publicId === value);
    state.mediaName = filterItem?.name ?? getMediaName(findMediaByPublicId(value));
  }
}

export function showFilterMediaSearchModal(btnInteraction: ButtonInteraction) {
  const modal = new ModalBuilder().setCustomId('filter_media_search_modal').setTitle('Filter by name');

  const nameInput = new TextInputBuilder()
    .setCustomId('filter_media_name')
    .setLabel('Name')
    .setPlaceholder('English, Japanese, or Romaji (leave empty to clear)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));

  return btnInteraction.showModal(modal);
}

export function applyNameFilter(filterState: FilterMediaState, name: string): void {
  filterState.nameFilter = name;
  filterState.filteredMedia = name
    ? filterState.allMedia.filter((m) => mediaMatchesFilter(m, name))
    : filterState.allMedia;
  filterState.mediaPage = 0;
}

export function setupModalListener(
  client: Client,
  userId: string,
  state: SearchModalState,
  display: DisplayOptions,
  linkUrl: string | (() => string),
  extraButtons?: ButtonBuilder[],
  filterState?: FilterMediaState,
) {
  const handler = async (i: { isModalSubmit(): boolean } & ModalSubmitInteraction) => {
    if (!i.isModalSubmit()) return;
    if (i.user.id !== userId) return;

    try {
      if (i.customId === 'advanced_search_modal') {
        if (filterState) {
          filterState.allMedia = [];
          filterState.filteredMedia = [];
          filterState.nameFilter = '';
          filterState.cachedSearchStats = null;
        }
        await handleModalSubmit(i, state, display, linkUrl, extraButtons);
      }

      if (i.customId === 'filter_media_search_modal' && filterState) {
        await i.deferUpdate();
        const name = i.fields.getTextInputValue('filter_media_name').trim();
        applyNameFilter(filterState, name);
        await renderFilterMediaPage(i, state, filterState);
      }
    } catch (error) {
      log.error({ err: error }, 'Modal handler failed');
      await i.followUp({ content: 'Something went wrong.', ephemeral: true });
    }
  };

  client.on('interactionCreate', handler as any);

  return () => client.off('interactionCreate', handler as any);
}
