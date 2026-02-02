import type {
  t_SearchResponse,
  t_SearchHealthCheckResponse,
  t_SearchMultipleResponse,
  t_FetchSentenceContextResponse,
  t_MediaInfoData,
  t_Sentence,
  t_Statistic,
  t_CategoryStatistic,
  t_WordMatch,
} from 'generated/models';
import type {
  QuerySegmentsResponse,
  SearchAnimeSentencesStatistics,
  SearchAnimeSentencesSegment,
} from '@lib/types/querySegmentsResponse';
import type { QueryWordsMatchedResponse, WordMatch } from '@lib/types/queryWordsMatchedResponse';
import type { QuerySurroundingSegmentsResponse } from '@lib/types/querySurroundingSegmentsResponse';
import { CategoryType, Media } from '@app/entities';
import { getBaseUrlMedia } from '@lib/utils/utils';

/**
 * Maps QuerySegmentsResponse to t_SearchResponse
 */
export const toSearchResponse = (response: QuerySegmentsResponse): t_SearchResponse => ({
  statistics: response.statistics.map(toStatistic),
  sentences: response.sentences.map(toSentence),
  categoryStatistics: response.categoryStatistics?.map(toCategoryStatistic) ?? [],
  cursor: response.cursor as number[] | undefined,
});

/**
 * Maps QuerySegmentsResponse to t_SearchHealthCheckResponse
 */
export const toSearchHealthCheckResponse = (response: QuerySegmentsResponse): t_SearchHealthCheckResponse => ({
  statistics: response.statistics.map(toStatistic),
  sentences: response.sentences.map(toSentence),
  categoryStatistics: response.categoryStatistics?.map(toCategoryStatistic) ?? [],
  cursor: response.cursor as number[] | undefined,
});

/**
 * Maps QueryWordsMatchedResponse to t_SearchMultipleResponse
 */
export const toSearchMultipleResponse = (response: QueryWordsMatchedResponse): t_SearchMultipleResponse => ({
  results: response.results.map(toWordMatch),
});

/**
 * Maps QuerySurroundingSegmentsResponse to t_FetchSentenceContextResponse
 */
export const toFetchSentenceContextResponse = (
  response: QuerySurroundingSegmentsResponse,
): t_FetchSentenceContextResponse => ({
  sentences: response.sentences.map(toSentence),
});

/**
 * Maps SearchAnimeSentencesStatistics to t_Statistic
 */
const toStatistic = (stat: SearchAnimeSentencesStatistics): t_Statistic => ({
  anime_id: stat.anime_id,
  name_anime_en: stat.name_anime_en,
  name_anime_jp: stat.name_anime_jp,
  amount_sentences_found: stat.amount_sentences_found,
  season_with_episode_hits: stat.season_with_episode_hits,
});

/**
 * Maps category statistics to t_CategoryStatistic
 */
const toCategoryStatistic = (stat: { category: number; count: number }): t_CategoryStatistic => ({
  category: stat.category,
  count: stat.count,
});

/**
 * Maps SearchAnimeSentencesSegment to t_Sentence
 */
const toSentence = (segment: SearchAnimeSentencesSegment): t_Sentence => {
  return {
    basic_info: {
      id_anime: segment.basic_info.id_anime,
      name_anime_romaji: segment.basic_info.name_anime_en, // Using english_name as romaji fallback
      name_anime_en: segment.basic_info.name_anime_en,
      name_anime_jp: segment.basic_info.name_anime_jp,
      cover: segment.basic_info.cover,
      banner: segment.basic_info.banner,
      season: segment.basic_info.season,
      episode: segment.basic_info.episode,
      category: 1, // Default category, can be enhanced if needed
    },
    segment_info: {
      status: segment.segment_info.status,
      uuid: segment.segment_info.uuid,
      position: segment.segment_info.position,
      start_time: segment.segment_info.start_time,
      end_time: segment.segment_info.end_time,
      content_jp: segment.segment_info.content_jp,
      content_jp_highlight: segment.segment_info.content_jp_highlight,
      content_en: segment.segment_info.content_en,
      content_en_highlight: segment.segment_info.content_en_highlight,
      content_en_mt: segment.segment_info.content_en_mt,
      content_es: segment.segment_info.content_es,
      content_es_highlight: segment.segment_info.content_es_highlight,
      content_es_mt: segment.segment_info.content_es_mt,
      is_nsfw: segment.segment_info.is_nsfw,
      actor_ja: segment.segment_info.actor_ja,
      actor_en: segment.segment_info.actor_en,
      actor_es: segment.segment_info.actor_es,
    },
    media_info: {
      path_image: segment.media_info.path_image,
      path_audio: segment.media_info.path_audio,
      path_video: segment.media_info.path_video,
    },
  };
};

/**
 * Maps WordMatch to t_WordMatch
 */
const toWordMatch = (match: WordMatch): t_WordMatch => ({
  word: match.word,
  is_match: match.is_match,
  total_matches: match.total_matches,
  media: (
    match.media as Array<{
      media_id: number;
      english_name: string;
      japanese_name: string;
      romaji_name: string;
      matches: number;
    }>
  ).map((m) => ({
    media_id: m.media_id,
    english_name: m.english_name,
    japanese_name: m.japanese_name,
    romaji_name: m.romaji_name,
    matches: m.matches,
  })),
});

/**
 * Category enum to number mapping for database compatibility
 */
const CATEGORY_TO_NUMBER: Record<string, number> = {
  [CategoryType.ANIME]: 1,
  [CategoryType.BOOK]: 2,
  [CategoryType.JDRAMA]: 3,
  [CategoryType.AUDIOBOOK]: 4,
} as const;

/**
 * Maps Media entity to t_MediaInfoData for fetchMediaInfo endpoint
 */
export const toMediaInfoData = (media: Media): t_MediaInfoData => {
  const locationMedia =
    media.category === CategoryType.ANIME ? 'anime' : media.category === CategoryType.JDRAMA ? 'jdrama' : 'audiobook';

  // Format dates as YYYY-MM-DD strings
  const formatDate = (date: Date): string => date.toISOString().split('T')[0];

  return {
    id: media.id,
    anilist_id: media.anilistId,
    japanese_name: media.japaneseName,
    romaji_name: media.romajiName,
    english_name: media.englishName,
    airing_format: media.airingFormat,
    airing_status: media.airingStatus,
    genres: media.genres,
    cover: [getBaseUrlMedia(), locationMedia, media.coverUrl].join('/'),
    banner: [getBaseUrlMedia(), locationMedia, media.bannerUrl].join('/'),
    start_date: formatDate(media.startDate),
    end_date: media.endDate ? formatDate(media.endDate) : null,
    category: CATEGORY_TO_NUMBER[media.category] ?? 1,
    num_segments: media.numSegments,
    num_episodes: media.episodes?.length ?? 0,
    num_seasons: 1,
    version: media.version,
    folder_media_name: `${media.romajiName.replace(/[^a-zA-Z0-9]/g, '_')}`,
    created_at: media.createdAt.toISOString(),
    updated_at: undefined,
    tmdb_id: null,
  };
};
