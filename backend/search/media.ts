import connection from "../database/db_posgres";
import {QueryMediaInfoResponse} from "../models/search/queryMediaInfoResponse";

let MEDIA_TABLE_CACHE: QueryMediaInfoResponse | undefined = undefined;

// Return data from Media table. This table almost never changes and is quite small, so we can cache it on memory to
// save extra calls to the DB
export const queryMediaInfo = async () => {
    if(!MEDIA_TABLE_CACHE) {
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
      ORDER BY me.created_at DESC`;

        const queryResponse = await connection.query(sql);

        MEDIA_TABLE_CACHE = {};
        queryResponse[0].forEach((result: any) => {
            if(!("media_id" in result.media_info)) {
                console.log("WARN: Invalid query, media_id not found");
                return;
            }

            MEDIA_TABLE_CACHE[Number(result.media_info["media_id"])] = result.media_info;
        })
    }

    return MEDIA_TABLE_CACHE;
}

export const invalidateCache = () => {
    MEDIA_TABLE_CACHE = undefined;
}