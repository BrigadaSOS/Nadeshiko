/**
 * Service layer for search operations
 * Extracted business logic that can be used by both OpenAPI handlers and legacy controllers
 */

import { querySegments, querySurroundingSegments, queryWordsMatched } from '../external/elasticsearch';
import { queryMediaInfo } from '../external/database_queries';
import { SaveUserSearchHistory } from '../controllers/databaseController';
import { EventTypeHistory } from '../models/miscellaneous/userSearchHistory';
import requestIp from 'request-ip';
import type { Request } from 'express';
import { Media } from '../models/media/media';
import { CategoryType } from '../models/media/media';
import { Op } from 'sequelize';
import { getBaseUrlMedia } from '../utils/utils';

/**
 * Search for anime sentences
 */
export async function searchAnimeSentences(
  params: {
    query?: string;
    uuid?: string;
    limit?: number;
    content_sort?: string;
    cursor?: number[];
    random_seed?: number;
    anime_id?: number;
    season?: number[];
    episode?: number[];
    category?: number; // Single number from OpenAPI schema
    exact_match?: boolean;
    extra?: boolean;
    min_length?: number;
    max_length?: number;
    excluded_anime_ids?: number[];
  },
  req?: Request,
) {
  // Convert category from single number to array for the query function
  const categoryArray = params.category ? [params.category] : [1, 2, 3, 4];

  const response = await querySegments({
    query: params.query,
    uuid: params.uuid,
    length_sort_order: params.content_sort || 'none',
    limit: params.limit || 10,
    status: [1],
    cursor: params.cursor,
    random_seed: params.random_seed,
    media: undefined,
    anime_id: params.anime_id,
    exact_match: params.exact_match,
    season: params.season,
    episode: params.episode,
    category: categoryArray,
    extra: params.extra || false,
    min_length: params.min_length,
    max_length: params.max_length,
    excluded_anime_ids: params.excluded_anime_ids || [],
  });

  // Save search history if this is a new search (not a cursor pagination)
  if (!params.cursor && params.query && req) {
    const hits = response.statistics.reduce((total, item) => {
      return total + item.amount_sentences_found;
    }, 0);
    await SaveUserSearchHistory(
      EventTypeHistory.SEARCH_MAIN_QUERY_TEXT,
      params.query,
      requestIp.getClientIp(req),
      hits,
    );
  }

  return response;
}

/**
 * Health check for search service
 */
export async function searchHealth() {
  return await querySegments({
    query: 'あ',
    length_sort_order: 'none',
    limit: 10,
    status: [1],
    category: [1, 2, 3, 4],
  });
}

/**
 * Get surrounding context for a sentence
 */
export async function getContextAnime(params: {
  media_id?: number;
  season?: number;
  episode?: number;
  segment_position?: number;
  limit?: number;
}) {
  // The original service requires these fields, but OpenAPI makes them optional
  // We'll pass them through - the validation happens in the OpenAPI layer
  return await querySurroundingSegments({
    media_id: params.media_id ?? 0,
    season: params.season ?? 0,
    episode: params.episode ?? 0,
    segment_position: params.segment_position ?? 0,
    limit: params.limit,
  });
}

/**
 * Search for media matching multiple words
 */
export async function getWordsMatched(params: {
  words?: string[];
  exact_match?: boolean;
}) {
  const { words, exact_match } = params;
  // The service requires words array, default to empty if not provided
  // Default exact_match to false if not provided
  return await queryWordsMatched(words || [], exact_match ?? false);
}

/**
 * Get all media with pagination
 */
export async function getAllMedia(params: {
  size?: number;
  sorted?: boolean;
  query?: string;
  type?: string;
  cursor?: number;
}) {
  const pageSize = params.size || 20;
  const cursor = params.cursor || 0;
  const searchQuery = params.query || '';
  const type = params.type?.toLowerCase() || '';

  const page = Math.floor(cursor / pageSize) + 1;

  const categoryMap: Record<string, CategoryType> = {
    anime: CategoryType.ANIME,
    liveaction: CategoryType.JDRAMA,
    audiobook: CategoryType.AUDIOBOOK,
  };

  const whereClause: any = {};
  if (type && categoryMap[type]) {
    whereClause.category = categoryMap[type];
  }

  if (searchQuery) {
    whereClause[Op.or] = [
      { english_name: { [Op.iLike]: `%${searchQuery}%` } },
      { japanese_name: { [Op.iLike]: `%${searchQuery}%` } },
      { romaji_name: { [Op.iLike]: `%${searchQuery}%` } },
    ];
  }

  const { count, rows } = await Media.findAndCountAll({
    where: whereClause,
    order: [['created_at', 'DESC']],
    limit: pageSize,
    offset: cursor,
  });

  const mediaInfo = await queryMediaInfo(page, pageSize);

  const paginatedResults = rows.map((media) => {
    const mediaData = media.toJSON();
    const location_media =
      mediaData.category === CategoryType.ANIME
        ? 'anime'
        : mediaData.category === CategoryType.JDRAMA
          ? 'jdrama'
          : 'audiobook';
    mediaData.cover = [getBaseUrlMedia(), location_media, mediaData.cover].join('/');
    mediaData.banner = [getBaseUrlMedia(), location_media, mediaData.banner].join('/');
    return mediaData;
  });

  const nextCursor = cursor + paginatedResults.length;
  const hasMoreResults = nextCursor < count;

  const stats = {
    total_animes: count,
    total_segments: paginatedResults.reduce((sum, media) => sum + media.num_segments, 0),
    full_total_animes: mediaInfo.stats.full_total_animes,
    full_total_segments: mediaInfo.stats.full_total_segments,
  };

  return {
    stats,
    results: paginatedResults,
    cursor: hasMoreResults ? nextCursor : null,
    hasMoreResults,
  };
}
