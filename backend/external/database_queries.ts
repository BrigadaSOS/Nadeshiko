import connection from "../database/db_posgres";
import {
  MediaInfoData,
  QueryMediaInfoResponse,
} from "../models/external/queryMediaInfoResponse";
import { getBaseUrlMedia } from "../utils/utils";
import { Media } from '../models/media/media'

let MEDIA_TABLE_CACHE: QueryMediaInfoResponse | undefined = undefined;

// Return data from Media table. This table almost never changes and is quite small, so we can cache it on memory to
// save extra calls to the DB
export const queryMediaInfo = async (
  page: number = 1,
  pageSize: number = 10
): Promise<QueryMediaInfoResponse> => {
  if (MEDIA_TABLE_CACHE === undefined) {
    await refreshMediaInfoCache(page, pageSize);
  }
  return MEDIA_TABLE_CACHE!;
};

export const refreshMediaInfoCache = async (page: number, pageSize: number) => {
  const offset = (page - 1) * pageSize;

  const [mediaResults, counts] = await Promise.all([
    Media.findAll({
      attributes: [
        'id', 'category', 'created_at', 'updated_at', 'romaji_name', 'english_name', 
        'japanese_name', 'airing_format', 'airing_status', 'folder_media_name', 
        'genres', 'cover', 'banner', 'release_date', 'version', 
        'num_segments', 'num_seasons', 'num_episodes'
      ],
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: offset
    }),
    Media.count(),
    Media.sum('num_segments')
  ]);

  const results: { [key: number]: MediaInfoData } = {};
  let total_animes = 0;
  let total_segments = 0;

  mediaResults.forEach((media: any) => {
    const mediaInfo: MediaInfoData = {
      media_id: media.id,
      category: media.category,
      created_at: media.created_at.toISOString(),
      updated_at: media.updated_at ? Math.floor(media.updated_at.getTime() / 1000) : undefined,
      romaji_name: media.romaji_name,
      english_name: media.english_name,
      japanese_name: media.japanese_name,
      airing_format: media.airing_format,
      airing_status: media.airing_status,
      folder_media_name: media.folder_media_name,
      genres: media.genres,
      cover: media.cover,
      banner: media.banner,
      release_date: media.release_date,
      version: media.version,
      num_segments: media.num_segments,
      num_seasons: media.num_seasons,
      num_episodes: media.num_episodes
    };

    let location_media = mediaInfo.category == 1 ? 'anime' : 'jdrama';
    mediaInfo.cover = [getBaseUrlMedia(), location_media, mediaInfo.cover].join("/");
    mediaInfo.banner = [getBaseUrlMedia(), location_media, mediaInfo.banner].join("/");

    results[mediaInfo.media_id] = mediaInfo;
    total_segments += mediaInfo.num_segments;
    total_animes += 1;
  });

  MEDIA_TABLE_CACHE = {
    stats: {
      total_animes,
      full_total_animes: counts,
      full_total_segments: counts[1] || 0,
      total_segments,
    },
    results,
  };
};