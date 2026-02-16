import { querySearchStats, querySegments, queryWordsMatched } from '@app/services/elasticsearch';
import { trackActivity } from '@app/services/activityService';
import { ActivityType } from '@app/models/UserActivity';
import type { HealthCheck, SearchIndex, SearchStats, SearchWords } from 'generated/routes/search';
import type { t_SearchHealthCheckResponse } from 'generated/models';

export const healthCheck: HealthCheck = async (_params, respond) => {
  const searchResults = await querySegments({
    query: 'あ',
    lengthSortOrder: 'none',
    limit: 10,
    status: ['ACTIVE'],
  });

  return respond.with200().body(searchResults as t_SearchHealthCheckResponse);
};

export const searchIndex: SearchIndex = async ({ body }, respond, req) => {
  const searchResults = await querySegments({
    query: body.query,
    uuid: body.uuid,
    lengthSortOrder: body.contentSort,
    limit: body.limit,
    status: body.status,
    cursor: body.cursor,
    randomSeed: body.randomSeed,
    media: body.media,
    mediaId: body.mediaId,
    exactMatch: body.exactMatch,
    episode: body.episode,
    category: body.category,
    minLength: body.minLength,
    maxLength: body.maxLength,
    excludedMediaIds: body.excludedMediaIds,
  });

  // Track search activity (fire-and-forget, don't block response)
  if (req.user && body.query) {
    trackActivity(req.user, ActivityType.SEARCH, { searchQuery: body.query }).catch(() => {});
  }

  return respond.with200().body(searchResults);
};

export const searchStats: SearchStats = async ({ body }, respond) => {
  const stats = await querySearchStats({
    query: body.query,
    exactMatch: body.exactMatch,
    category: body.category,
    minLength: body.minLength,
    maxLength: body.maxLength,
    excludedMediaIds: body.excludedMediaIds,
    mediaIds: body.mediaIds,
    status: body.status,
  });

  return respond.with200().body(stats);
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  const searchResults = await queryWordsMatched(body.words, body.exactMatch);

  return respond.with200().body(searchResults);
};
