import { SegmentDocument } from '@app/models/SegmentDocument';
import { Media } from '@app/models';
import type { Search, GetSearchStats, SearchWords } from 'generated/routes/search';
import type { t_SearchFilters, t_MediaFilterItem } from 'generated/models';
import { toSearchResponseDTO } from './mappers/search.mapper';
import { assertUser } from '@app/middleware/authentication';
import { isExperimentActive } from '@lib/experiments';

export const search: Search = async ({ body }, respond, req) => {
  await resolveMediaFilterIds(body.filters);
  const user = assertUser(req);
  const tokensEnabled = await isExperimentActive(user, 'interactive-tokens');
  const searchResults = await SegmentDocument.search(body, 'strict', { tokensEnabled });
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
  await resolveMediaFilterIds(body.filters);
  const stats = await SegmentDocument.searchStats(body);
  return respond.with200().body(toSearchResponseDTO(stats, body.include));
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  await resolveMediaFilterIds(body.filters);
  const searchResults = await SegmentDocument.wordsMatched(body.query.words, body.query.exactMatch, body.filters);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

async function resolveMediaFilterIds(filters?: t_SearchFilters): Promise<void> {
  if (!filters?.media) return;

  const hasItems =
    (filters.media.include && filters.media.include.length > 0) ||
    (filters.media.exclude && filters.media.exclude.length > 0);
  if (!hasItems) return;

  const mediaInfo = await Media.getMediaInfoMap();

  resolveItems(filters.media.include, mediaInfo.results);
  resolveItems(filters.media.exclude, mediaInfo.results);
}

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>['results'];

function resolveItems(items: t_MediaFilterItem[] | undefined, mediaMap: MediaInfoMap): void {
  if (!items) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const resolved = resolveMediaId(items[i].mediaId, mediaMap);
    if (resolved !== null) {
      (items[i] as any).mediaId = resolved;
    } else {
      items.splice(i, 1);
    }
  }
}

function resolveMediaId(identifier: string, mediaMap: MediaInfoMap): number | null {
  for (const [id, info] of mediaMap) {
    if (info.publicId === identifier) return id;
  }

  for (const [id, info] of mediaMap) {
    const anilistId = info.externalIds?.anilist;
    if (anilistId && anilistId === identifier) return id;
  }

  return null;
}
