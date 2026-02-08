import { querySegments, querySurroundingSegments, queryWordsMatched } from '@lib/external/elasticsearch';
import type {
  FetchMediaInfo,
  FetchSentenceContext,
  Search,
  SearchHealthCheck,
  SearchMultiple,
} from 'generated/routes/search';
import type { t_FetchMediaInfoResponse, t_SearchHealthCheckResponse } from 'generated/models';
import { CategoryType, Media } from '@app/entities';
import { Like } from 'typeorm';
import { toMediaInfoData } from './mappers/search.mapper';
import { MediaInfoStats } from '@lib/types/queryMediaInfoResponse';

export const searchHealthCheck: SearchHealthCheck = async (_params, respond) => {
  const searchResults = await querySegments({
    query: 'あ',
    lengthSortOrder: 'none',
    limit: 10,
    status: [1],
  });

  return respond.with200().body(searchResults as t_SearchHealthCheckResponse);
};

export const search: Search = async ({ body }, respond) => {
  const searchResults = await querySegments({
    query: body.query,
    uuid: body.uuid,
    lengthSortOrder: body.contentSort,
    limit: body.limit,
    status: body.status,
    cursor: body.cursor,
    randomSeed: body.randomSeed,
    media: body.media,
    animeId: body.animeId,
    exactMatch: body.exactMatch,
    episode: body.episode,
    category: body.category, // Already string[] enum values
    extra: body.extra,
    minLength: body.minLength,
    maxLength: body.maxLength,
    excludedAnimeIds: body.excludedAnimeIds,
  });

  return respond.with200().body(searchResults);
};

export const searchMultiple: SearchMultiple = async ({ body }, respond) => {
  const searchResults = await queryWordsMatched(body.words, body.exactMatch);

  return respond.with200().body(searchResults);
};

export const fetchSentenceContext: FetchSentenceContext = async ({ body }, respond) => {
  const searchResults = await querySurroundingSegments({
    mediaId: body.mediaId,
    episode: body.episode,
    segmentPosition: body.segmentPosition,
    limit: body.limit || 5,
  });

  return respond.with200().body(searchResults);
};

export const fetchMediaInfo: FetchMediaInfo = async ({ query }, respond) => {
  const pageSize = query.size;
  const searchQuery = query.query;
  const cursor = query.cursor;
  const type = query.type;

  const categoryMap: Record<string, CategoryType> = {
    anime: CategoryType.ANIME,
    liveaction: CategoryType.JDRAMA,
  };

  const whereClause: Record<string, unknown> = {};
  if (type && categoryMap[type]) {
    whereClause.category = categoryMap[type];
  }

  if (searchQuery) {
    Object.assign(whereClause, [
      { englishName: Like(`%${searchQuery}%`) },
      { japaneseName: Like(`%${searchQuery}%`) },
      { romajiName: Like(`%${searchQuery}%`) },
    ]);
  }

  const [rows, count] = await Media.findAndCount({
    where: searchQuery ? whereClause : undefined,
    order: { createdAt: 'DESC' },
    take: pageSize,
    skip: cursor,
    relations: ['episodes'],
  });

  const globalStats = await Media.getGlobalStats();

  const paginatedResults = rows.map(toMediaInfoData);

  const nextCursor = cursor + paginatedResults.length;
  const hasMoreResults = nextCursor < count;

  const stats: MediaInfoStats = {
    totalAnimes: count,
    totalSegments: paginatedResults.reduce((sum, media) => sum + (media.numSegments ?? 0), 0),
    fullTotalAnimes: globalStats.fullTotalAnimes,
    fullTotalSegments: globalStats.fullTotalSegments,
  };

  const searchResults: t_FetchMediaInfoResponse = {
    stats,
    results: paginatedResults,
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  };

  return respond.with200().body(searchResults);
};
