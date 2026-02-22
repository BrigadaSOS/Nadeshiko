import { querySearchStats, querySegments, queryWordsMatched } from '@app/services/elasticsearch';
import { trackActivity } from '@app/services/activityService';
import { ActivityType } from '@app/models/UserActivity';
import type { Search, GetSearchStats, SearchWords } from 'generated/routes/search';

const shouldIncludeMedia = (include?: string[]): boolean => include?.includes('media') ?? false;

const stripIncludes = <T extends { includes?: { media?: unknown } }>(result: T): T => ({
  ...result,
  includes: { media: {} },
});

export const search: Search = async ({ body }, respond, req) => {
  const f = body.filters;
  const searchResults = await querySegments({
    query: body.query
      ? {
          search: body.query.search,
          exactMatch: body.query.exactMatch,
        }
      : undefined,
    sort: body.sort
      ? {
          mode: body.sort.mode,
          seed: body.sort.seed,
        }
      : undefined,
    limit: body.take,
    cursor: body.cursor,
    filters: {
      media: f?.media,
      category: f?.category,
      contentRating: f?.contentRating,
      status: f?.status ?? ['ACTIVE'],
      segmentLengthChars: f?.segmentLengthChars,
      segmentDurationMs: f?.segmentDurationMs,
      languages: f?.languages,
    },
  });

  // Track search activity (fire-and-forget, don't block response)
  // Only track the initial search, not pagination (scroll-to-load-more)
  if (req.user && body.query?.search && !body.cursor) {
    trackActivity(req.user, ActivityType.SEARCH, { searchQuery: body.query.search }).catch(() => {});
  }

  const response = shouldIncludeMedia(body.include) ? searchResults : stripIncludes(searchResults);
  return respond.with200().body(response);
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
  const f = body.filters;
  const stats = await querySearchStats({
    query: body.query
      ? {
          search: body.query.search,
          exactMatch: body.query.exactMatch,
        }
      : undefined,
    filters: {
      media: f?.media,
      category: f?.category,
      contentRating: f?.contentRating,
      status: f?.status ?? ['ACTIVE'],
      segmentLengthChars: f?.segmentLengthChars,
      segmentDurationMs: f?.segmentDurationMs,
      languages: f?.languages,
    },
  });

  const response = shouldIncludeMedia(body.include) ? stats : stripIncludes(stats);
  return respond.with200().body(response);
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  const f = body.filters;
  const searchResults = await queryWordsMatched(
    body.query.words,
    body.query.exactMatch,
    f
      ? {
          media: f.media,
          category: f.category,
          contentRating: f.contentRating,
          status: f.status ?? ['ACTIVE'],
          segmentLengthChars: f.segmentLengthChars,
          segmentDurationMs: f.segmentDurationMs,
          languages: f.languages,
        }
      : undefined,
  );

  const response = shouldIncludeMedia(body.include) ? searchResults : stripIncludes(searchResults);
  return respond.with200().body(response);
};
