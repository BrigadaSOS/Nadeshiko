import { querySegments, querySurroundingSegments, queryWordsMatched } from '@lib/external/elasticsearch';
import type {
  FetchMediaInfo,
  FetchSentenceContext,
  Search,
  SearchHealthCheck,
  SearchMultiple,
} from 'generated/routes/search';
import type { t_FetchMediaInfoResponse } from 'generated/models';
import { CategoryType, Media } from '@app/entities';
import { Like } from 'typeorm';
import { queryMediaInfo } from '@lib/external/database_queries';
import {
  toSearchResponse,
  toSearchHealthCheckResponse,
  toSearchMultipleResponse,
  toFetchSentenceContextResponse,
  toMediaInfoData,
} from './mappers/search.mapper';
import { MediaInfoStats } from '@lib/types/queryMediaInfoResponse';

export const searchHealthCheck: SearchHealthCheck = async (_params, respond) => {
  const searchResults = await querySegments({
    query: 'あ',
    length_sort_order: 'none',
    limit: 10,
    status: [1],
  });

  return respond.with200().body(toSearchHealthCheckResponse(searchResults));
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
    category: body.category,
    extra: body.extra,
    min_length: body.min_length,
    max_length: body.max_length,
    excluded_anime_ids: body.excluded_anime_ids,
  });

  return respond.with200().body(toSearchResponse(searchResults));
};

export const searchMultiple: SearchMultiple = async ({ body }, respond) => {
  const searchResults = await queryWordsMatched(body.words, body.exact_match);

  return respond.with200().body(toSearchMultipleResponse(searchResults));
};

export const fetchSentenceContext: FetchSentenceContext = async ({ body }, respond) => {
  const searchResults = await querySurroundingSegments({
    media_id: body.media_id,
    season: body.season,
    episode: body.episode,
    segment_position: body.segment_position,
    limit: body.limit || 5,
  });

  return respond.with200().body(toFetchSentenceContextResponse(searchResults));
};

export const fetchMediaInfo: FetchMediaInfo = async ({ query }, respond) => {
  const pageSize = query.size;
  const searchQuery = query.query;
  const cursor = query.cursor;
  const type = query.type;

  const page = Math.floor(cursor / pageSize) + 1;

  const categoryMap: Record<string, CategoryType> = {
    anime: CategoryType.ANIME,
    liveaction: CategoryType.JDRAMA,
    audiobook: CategoryType.AUDIOBOOK,
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

  const mediaInfo = await queryMediaInfo(page, pageSize);

  const paginatedResults = rows.map(toMediaInfoData);

  const nextCursor = cursor + paginatedResults.length;
  const hasMoreResults = nextCursor < count;

  const stats: MediaInfoStats = {
    total_animes: count,
    total_segments: paginatedResults.reduce((sum, media) => sum + (media.num_segments ?? 0), 0),
    full_total_animes: mediaInfo.stats.full_total_animes,
    full_total_segments: mediaInfo.stats.full_total_segments,
  };

  const searchResults: t_FetchMediaInfoResponse = {
    stats,
    results: paginatedResults,
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  };

  return respond.with200().body(searchResults);
};
