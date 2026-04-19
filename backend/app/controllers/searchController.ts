import { SegmentDocument } from '@app/models/SegmentDocument';
import type { Search, GetSearchStats, SearchWords } from 'generated/routes/search';
import { toSearchResponseDTO } from './mappers/searchMapper';
import { normalizeLanguageFilter, resolveMediaFilterIds } from './searchFilters';

export const search: Search = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  await resolveMediaFilterIds(body.filters);
  const searchResults = await SegmentDocument.search(body, 'strict');
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  await resolveMediaFilterIds(body.filters);
  const stats = await SegmentDocument.searchStats(body);
  return respond.with200().body(toSearchResponseDTO(stats, body.include));
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  normalizeLanguageFilter(body.filters);
  await resolveMediaFilterIds(body.filters);
  const searchResults = await SegmentDocument.wordsMatched(body.query.words, body.query.exactMatch, body.filters);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};
