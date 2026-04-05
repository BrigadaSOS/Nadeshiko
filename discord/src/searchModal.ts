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
import { search } from './api';
import type { SearchResponse } from './api';
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
  };
};

export const firstPageButton = new ButtonBuilder()
  .setCustomId('first_page')
  .setLabel('<<')
  .setStyle(ButtonStyle.Secondary)
  .setDisabled(true);

export const prevPageButton = new ButtonBuilder()
  .setCustomId('prev_page')
  .setLabel('<')
  .setStyle(ButtonStyle.Secondary)
  .setDisabled(true);

export const nextPageButton = new ButtonBuilder()
  .setCustomId('next_page')
  .setLabel('>')
  .setStyle(ButtonStyle.Secondary);

export const randomResultButton = new ButtonBuilder()
  .setCustomId('random_result')
  .setLabel('Random')
  .setStyle(ButtonStyle.Secondary)
  .setEmoji('🎲');

export function createSearchModalState(mediaId?: string): SearchModalState {
  return {
    results: null,
    currentIndex: 0,
    mediaId,
    mediaName: undefined,
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

export function buildPaginationButtons(state: SearchModalState): ButtonBuilder[] {
  const atFirst = state.currentPage === 0;
  const hasMore = state.results?.pagination.hasMore ?? false;
  const first = ButtonBuilder.from(firstPageButton.toJSON()).setDisabled(atFirst);
  const prev = ButtonBuilder.from(prevPageButton.toJSON()).setDisabled(atFirst);
  const next = ButtonBuilder.from(nextPageButton.toJSON()).setDisabled(!hasMore);
  return [first, prev, next];
}

export function getPageOffset(state: SearchModalState): number {
  return state.currentPage * BOT_CONFIG.maxSearchResults;
}

export function showSearchModal(btnInteraction: ButtonInteraction, title: string, defaults?: { query?: string }) {
  const modal = new ModalBuilder().setCustomId('advanced_search_modal').setTitle(title.slice(0, 45));

  const queryInput = new TextInputBuilder()
    .setCustomId('search_query')
    .setLabel('Search query')
    .setPlaceholder('e.g. a Japanese word or English phrase')
    .setStyle(TextInputStyle.Short)
    .setValue(defaults?.query ?? '')
    .setRequired(false);

  const episodeInput = new TextInputBuilder()
    .setCustomId('search_episodes')
    .setLabel('Episode(s)')
    .setPlaceholder('e.g. 1, 3-5, 12')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const exactInput = new TextInputBuilder()
    .setCustomId('search_exact')
    .setLabel('Exact match?')
    .setPlaceholder('yes or no')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(queryInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(episodeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(exactInput),
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
  linkUrl: string,
  extraButtons?: ButtonBuilder[],
): Promise<boolean> {
  await modalInteraction.deferUpdate();

  const searchQuery = modalInteraction.fields.getTextInputValue('search_query').trim() || '*';
  const episodesRaw = modalInteraction.fields.getTextInputValue('search_episodes').trim();
  const exactRaw = modalInteraction.fields.getTextInputValue('search_exact').trim().toLowerCase();

  const episodes = parseEpisodes(episodesRaw);
  const exactMatch = exactRaw === 'yes' || exactRaw === 'y' ? true : undefined;

  state.lastSearchOptions = { exactMatch, episodes };

  const searchResult = await search(searchQuery, {
    take: BOT_CONFIG.maxSearchResults,
    mediaId: state.mediaId,
    episodes,
    exactMatch,
  });

  if (searchResult.segments.length === 0) {
    await modalInteraction.followUp({
      content: `No results found for "${searchQuery}".`,
      ephemeral: true,
    });
    return false;
  }

  state.lastQuery = searchQuery;
  resetPages(state, searchResult);

  await renderSearchResult(modalInteraction, state, display, linkUrl, extraButtons);
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
  const total = state.results.pagination.estimatedTotalHits;
  const pageOffset = getPageOffset(state);
  const totalPages = Math.ceil(total / BOT_CONFIG.maxSearchResults);
  const pageLabel = totalPages > 1 ? ` (page ${state.currentPage + 1} of ~${totalPages})` : '';
  const queryLabel = state.lastQuery !== '*' ? ` for "${state.lastQuery}"` : '';
  const content = `🔎 **~${total.toLocaleString()} results**${queryLabel}${pageLabel}\n${segContent}`;

  const paginationButtons = buildPaginationButtons(state);
  const buttons = [...paginationButtons, ...(extraButtons ?? []), randomResultButton];
  const components = buildSearchSelectComponents(
    state.results.segments,
    state.results.includes.media,
    seg.publicId,
    linkUrl,
    buttons,
    pageOffset,
  );

  const files = await loadVideoFiles(seg);

  await interaction.editReply({ content, components, files });
}

const MEDIA_PER_PAGE = 24;

function collectAllMedia(state: SearchModalState): { publicId: string; name: string; nameJa?: string }[] {
  const seen = new Set<string>();
  const allMedia: { publicId: string; name: string; nameJa?: string }[] = [];

  for (const page of state.pages) {
    for (const m of Object.values(page.includes.media)) {
      if (seen.has(m.publicId)) continue;
      seen.add(m.publicId);
      allMedia.push({ publicId: m.publicId, name: getMediaName(m), nameJa: m.nameJa });
    }
  }

  allMedia.sort((a, b) => a.name.localeCompare(b.name));
  return allMedia;
}

export type FilterMediaState = {
  mediaPage: number;
  allMedia: { publicId: string; name: string; nameJa?: string }[];
};

export function createFilterMediaState(): FilterMediaState {
  return { mediaPage: 0, allMedia: [] };
}

export async function showFilterMediaSelect(
  btnInteraction: ButtonInteraction,
  state: SearchModalState,
  filterState: FilterMediaState,
) {
  await btnInteraction.deferUpdate();

  if (!state.results) return;

  filterState.allMedia = collectAllMedia(state);
  filterState.mediaPage = 0;

  await renderFilterMediaPage(btnInteraction, state, filterState);
}

export async function renderFilterMediaPage(
  interaction: { editReply: ButtonInteraction['editReply'] },
  state: SearchModalState,
  filterState: FilterMediaState,
) {
  const { allMedia, mediaPage } = filterState;
  const totalPages = Math.ceil(allMedia.length / MEDIA_PER_PAGE);
  const start = mediaPage * MEDIA_PER_PAGE;
  const pageMedia = allMedia.slice(start, start + MEDIA_PER_PAGE);

  const list = pageMedia.map((m, i) => `\`${start + i + 1}.\` ${m.name}`).join('\n');

  const pageLabel = totalPages > 1 ? ` (page ${mediaPage + 1} of ${totalPages})` : '';
  const header = `**Filter by media**${pageLabel}\n${list}`;

  const options = pageMedia.map((m) => ({
    label: m.name.slice(0, 100),
    value: m.publicId,
    description: m.nameJa?.slice(0, 100),
    default: m.publicId === state.mediaId,
  }));

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

  const buttons: ButtonBuilder[] = [];
  if (totalPages > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('filter_media_prev')
        .setLabel('<')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(mediaPage === 0),
      new ButtonBuilder()
        .setCustomId('filter_media_next')
        .setLabel('>')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(mediaPage >= totalPages - 1),
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId('cancel_filter_media').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

  await interaction.editReply({
    content: header,
    components: [selectRow, buttonRow],
    files: [],
  });
}

export function handleFilterMediaSelect(selectInteraction: StringSelectMenuInteraction, state: SearchModalState): void {
  const value = selectInteraction.values[0];

  if (value === '__all__') {
    state.mediaId = undefined;
    state.mediaName = undefined;
  } else {
    state.mediaId = value;
    const mediaItem = findMediaByPublicId(value);
    state.mediaName = getMediaName(mediaItem);
  }
}

export function setupModalListener(
  client: Client,
  userId: string,
  state: SearchModalState,
  display: DisplayOptions,
  linkUrl: string | (() => string),
  extraButtons?: ButtonBuilder[],
) {
  const handler = async (i: { isModalSubmit(): boolean } & ModalSubmitInteraction) => {
    if (!i.isModalSubmit()) return;
    if (i.user.id !== userId) return;

    try {
      if (i.customId === 'advanced_search_modal') {
        const url = typeof linkUrl === 'function' ? linkUrl() : linkUrl;
        await handleModalSubmit(i, state, display, url, extraButtons);
      }
    } catch (error) {
      log.error({ err: error }, 'Modal handler failed');
      await i.followUp({ content: 'Something went wrong.', ephemeral: true });
    }
  };

  client.on('interactionCreate', handler as any);

  return () => client.off('interactionCreate', handler as any);
}
