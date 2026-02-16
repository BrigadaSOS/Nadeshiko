import {
  querySearchStats,
  querySegments,
  querySurroundingSegments,
  queryWordsMatched,
} from '@app/services/elasticsearch';
import type {
  BrowseMedia,
  GetSearchStats,
  GetSegmentContext,
  HealthCheck,
  SearchSegments,
  SearchWords,
} from 'generated/routes/search';
import type { t_MediaBrowseResponse, t_SearchHealthCheckResponse } from 'generated/models';
import { CategoryType, Media } from '@app/models';
import { Like } from 'typeorm';
import { toMediaSummary } from './mappers/search.mapper';

export const healthCheck: HealthCheck = async (_params, respond) => {
  const searchResults = await querySegments({
    query: 'あ',
    lengthSortOrder: 'none',
    limit: 10,
    status: ['ACTIVE'],
  });

  return respond.with200().body(searchResults as t_SearchHealthCheckResponse);
};

export const searchSegments: SearchSegments = async ({ body }, respond) => {
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

  return respond.with200().body(searchResults);
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
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

export const getSegmentContext: GetSegmentContext = async ({ body }, respond) => {
  const searchResults = await querySurroundingSegments({
    mediaId: body.mediaId,
    episodeNumber: body.episodeNumber,
    segmentPosition: body.segmentPosition,
    limit: body.limit || 5,
  });

  return respond.with200().body(searchResults);
};

export const browseMedia: BrowseMedia = async ({ query }, respond) => {
  const pageSize = query.size;
  const searchQuery = query.query;
  const cursor = query.cursor;
  const type = query.type;

  const categoryMap: Record<string, CategoryType> = {
    anime: CategoryType.ANIME,
    liveaction: CategoryType.JDRAMA,
  };

  const categoryFilter: Record<string, unknown> = {};
  if (type && categoryMap[type]) {
    categoryFilter.category = categoryMap[type];
  }

  let whereClause: Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (searchQuery) {
    whereClause = [
      { ...categoryFilter, nameEn: Like(`%${searchQuery}%`) },
      { ...categoryFilter, nameJa: Like(`%${searchQuery}%`) },
      { ...categoryFilter, nameRomaji: Like(`%${searchQuery}%`) },
    ];
  } else if (Object.keys(categoryFilter).length > 0) {
    whereClause = categoryFilter;
  }

  const [rows, count] = await Media.findAndCount({
    where: whereClause,
    order: { createdAt: 'DESC' },
    take: pageSize,
    skip: cursor,
    relations: ['episodes', 'externalIds'],
  });

  const globalStats = await Media.getGlobalStats();

  const paginatedResults = rows.map(toMediaSummary);

  const nextCursor = cursor + paginatedResults.length;
  const hasMore = nextCursor < count;

  const searchResults: t_MediaBrowseResponse = {
    stats: {
      filteredMediaCount: count,
      filteredSegmentCount: paginatedResults.reduce((sum, media) => sum + (media.segmentCount ?? 0), 0),
      totalMediaCount: globalStats.fullTotalAnimes,
      totalSegmentCount: globalStats.fullTotalSegments,
    },
    results: paginatedResults,
    cursor: hasMore ? nextCursor : undefined,
    hasMore,
  };

  return respond.with200().body(searchResults);
};
