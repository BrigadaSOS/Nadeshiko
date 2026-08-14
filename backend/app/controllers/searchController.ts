import { SegmentDocument } from '@app/services/search/SegmentDocument';
import type { Search, GetSearchStats, SearchWords } from 'generated/routes/search';
import { toSearchResponseDTO } from './mappers/searchMapper';
import { normalizeLanguageFilter, resolveMediaFilterIds, resolvePreferredMediaIds } from './searchFilters';

export const search: Search = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  const filters = await resolveMediaFilterIds(body.filters);
  const preferredMediaIds = await resolvePreferredMediaIds(body.sort, body.preferMedia);
  const searchResults = await SegmentDocument.search({ ...body, filters }, 'strict', preferredMediaIds);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  const filters = await resolveMediaFilterIds(body.filters);
  const stats = await SegmentDocument.searchStats({ ...body, filters });
  return respond.with200().body(toSearchResponseDTO(stats, body.include));
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  const filters = await resolveMediaFilterIds(body.filters);
  const searchResults = await SegmentDocument.wordsMatched(body.query.words, body.query.exactMatch, filters);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};
