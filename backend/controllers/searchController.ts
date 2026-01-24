import { querySegments, querySurroundingSegments, queryWordsMatched } from 'external/elasticsearch';
import type {
  FetchMediaInfo,
  FetchSentenceContext,
  Search,
  SearchHealthCheck,
  SearchMultiple,
} from 'generated/routes/search';
import { EventTypeHistory, UserSearchHistory } from 'models/miscellaneous/userSearchHistory';
import requestIp from 'request-ip';
import { CategoryType, Media } from 'models/media/media';
import { Op } from 'sequelize';
import { queryMediaInfo } from 'external/database_queries';
import { getBaseUrlMedia } from 'utils/utils';
import { MediaInfoStats } from 'models/external/queryMediaInfoResponse';
import logger from 'utils/log';

export const searchHealthCheck: SearchHealthCheck = async (_params, respond) => {
  const searchResults = await querySegments({
    query: 'あ',
    length_sort_order: 'none',
    limit: 10,
    status: [1],
  });

  return respond.with200().body(searchResults);
};

export const search: Search = async ({ body }, respond, req) => {
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

  if (!body.cursor && body.query) {
    const hits = searchResults.statistics.reduce((total, item) => {
      return total + item.amount_sentences_found;
    }, 0);
    await SaveUserSearchHistory(EventTypeHistory.SEARCH_MAIN_QUERY_TEXT, body.query, requestIp.getClientIp(req), hits);
  }

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
    // Serialize Date objects to ISO strings for created_at
    if (mediaData.created_at instanceof Date) {
      mediaData.created_at = mediaData.created_at.toISOString();
    }
    // release_date can be null, ensure it stays as-is or convert Date to string
    if (mediaData.release_date instanceof Date) {
      mediaData.release_date = mediaData.release_date.toISOString();
    }
    return mediaData;
  });

  const nextCursor = cursor + paginatedResults.length;
  const hasMoreResults = nextCursor < count;

  const stats: MediaInfoStats = {
    total_animes: count,
    total_segments: paginatedResults.reduce((sum, media) => sum + media.num_segments, 0),
    full_total_animes: mediaInfo.stats.full_total_animes,
    full_total_segments: mediaInfo.stats.full_total_segments,
  };

  const searchResults = {
    stats,
    results: paginatedResults,
    cursor: hasMoreResults ? nextCursor : undefined,
    hasMoreResults,
  };

  return respond.with200().body(searchResults);
};

export const SaveUserSearchHistory = async (EventType: number, Query: any, IP: any, Hits: any) => {
  try {
    const searchLog = await UserSearchHistory.create({
      event_type: EventType,
      query: Query,
      ip_address: IP,
      hits: Hits,
    });
    await searchLog.save();
  } catch (error) {
    logger.error({ err: error, EventType, Query, IP, Hits }, 'Error inserting search log into database');
  }
};
