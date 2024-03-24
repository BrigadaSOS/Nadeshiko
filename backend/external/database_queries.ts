import connection from "../database/db_posgres";
import {
  MediaInfoData,
  QueryMediaInfoResponse,
} from "../models/external/queryMediaInfoResponse";
import { getBaseUrlMedia } from "../utils/utils";

let MEDIA_TABLE_CACHE: QueryMediaInfoResponse | undefined = undefined;

// Return data from Media table. This table almost never changes and is quite small, so we can cache it on memory to
// save extra calls to the DB
export const queryMediaInfo = async (
  page: number = 1,
  pageSize: number = 10
): Promise<QueryMediaInfoResponse> => {
  // TODO: Fix cache
  //if(MEDIA_TABLE_CACHE === undefined) {
  //}
  await refreshMediaInfoCache(page, pageSize);

  return MEDIA_TABLE_CACHE!;
};

export const refreshMediaInfoCache = async (page: number, pageSize: number) => {
  const safePage = Math.max(page, 1);
  const offset = (safePage - 1) * pageSize;
  
  const sql = `SELECT 
  json_build_object(
    'media_id', me.id,
    'created_at', me.created_at,
    'updated_at', me.updated_at,
    'romaji_name', me.romaji_name,
    'english_name', me.english_name, 
    'japanese_name', me.japanese_name,
    'airing_format', me.airing_format,
    'airing_status', me.airing_status,
    'folder_media_name', me.folder_media_name,
    'genres', me.genres,
    'cover', me.cover,
    'banner', me.banner,
    'version', me.version,
    'num_segments', me.num_segments,
    'num_seasons', me.num_seasons,
    'num_episodes', me.num_episodes
  ) AS media_info
    FROM 
      nadedb.public."Media" me
    GROUP BY 
      me.id, me.romaji_name, me.english_name, me.japanese_name
    ORDER BY me.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`;

  const sql_full = 'SELECT ( SELECT COUNT(*) FROM nadedb.public."Media" ) AS count1, ( SELECT COUNT(*) FROM nadedb.public."Segment" ) AS count2'

  const queryResponse = await connection.query(sql);
  const queryResponseFull = await connection.query(sql_full);
  //@ts-ignore
  const full_total_animes = parseInt(queryResponseFull[0][0].count1, 10);
  //@ts-ignore
  const full_total_segments = parseInt(queryResponseFull[0][0].count2, 10);

  const results: { [key: number]: MediaInfoData } = {};
  let total_animes = 0;
  let total_segments = 0;

  queryResponse[0].forEach((result: any) => {
    if (!("media_id" in result.media_info)) {
      console.log("WARN: Invalid query, media_id not found");
      return;
    }

    result.media_info.cover = [getBaseUrlMedia(), result.media_info.cover].join(
      "/"
    );
    result.media_info.banner = [
      getBaseUrlMedia(),
      result.media_info.banner,
    ].join("/");

    results[Number(result.media_info["media_id"])] = result.media_info;

    total_segments += result.media_info.num_segments;
    total_animes += 1;
  });

  MEDIA_TABLE_CACHE = {
    stats: {
      total_animes,
      full_total_animes,
      full_total_segments,
      total_segments,
    },
    results,
  };
};
