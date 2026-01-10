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
    length_sort_order: 'none',
    limit: 10,
    status: [1],
  });

  return respond.with200().body(searchResults as t_SearchHealthCheckResponse);
};

export const search: Search = async ({ body }, respond) => {
  const searchResults = await querySegments({
    query: body.query,
    uuid: body.uuid,
    length_sort_order: body.content_sort,
    limit: body.limit,
    status: body.status,
    cursor: body.cursor,
    random_seed: body.random_seed,
    media: body.media,
    anime_id: body.anime_id,
    exact_match: body.exact_match,
    season: body.season,
    episode: body.episode,
    category: body.category, // Already string[] enum values
    extra: body.extra,
    min_length: body.min_length,
    max_length: body.max_length,
    excluded_anime_ids: body.excluded_anime_ids,
  });

  return respond.with200().body(searchResults);
};

export const searchMultiple: SearchMultiple = async ({ body }, respond) => {
  const searchResults = await queryWordsMatched(body.words, body.exact_match);

  return respond.with200().body(searchResults);
};

export const fetchSentenceContext: FetchSentenceContext = async ({ body }, respond) => {
  const searchResults = await querySurroundingSegments({
    media_id: body.media_id,
    season: body.season,
    episode: body.episode,
    segment_position: body.segment_position,
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
