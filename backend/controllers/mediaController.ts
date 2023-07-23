import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { Segment } from "../models/media/segment";
import { Media } from "../models/media/media";
import { Episode } from "../models/media/episode";
import { Season } from "../models/media/season";
import { Op, Sequelize } from "sequelize";
import { pipeline, Transform } from "stream";
import { v3 as uuidv3 } from "uuid";
import connection from "../database/db_posgres";

import axios from "axios";
import path from "path";
import url from "url";
import fs from "fs";

const BASE_URL_MEDIA = process.env.BASE_URL_MEDIA;
const BASE_URL_TMP = process.env.BASE_URL_TMP;
const tmpDirectory: string = process.env.TMP_DIRECTORY!;

/**
 * Genera una URL con el acceso al archivo MP3.
 * Primero se genera un HASH con base a las URLs proporcionadas. El HASH es el nombre del archivo MP3.
 * Si no lo encuentra en la carpeta tmp, procede a hacer merge de las URLs y genera el archivo MP3.
 * Devuelve la URL del archivo MP3 generado/encontrado.
 * @param  {Request} req - Request con las URLs a procesar.
 * @param  {Response} res - Response con la URL del archivo MP3 generado/encontrado.
 * @param  {NextFunction} next - NextFunction
 * @returns {Promise<Response>} - Devuelve la URL del archivo MP3 generado/encontrado.
 */
export const generateURLAudio = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const urls: string[] = req.body.urls;

    if (!Array.isArray(urls) || urls.length === 0) {
      throw new BadRequest("Debe ingresar una lista de URLs MP3.");
    }

    let protocol: string = "";
    if (process.env.ENVIRONMENT == "production") {
      protocol = "https";
    } else if (process.env.ENVIRONMENT == "testing") {
      protocol = "http";
    }

    const urlHash = urls.join("");

    const randomFilename = `${uuidv3(
      urlHash,
      process.env.UUID_NAMESPACE!
    )}.mp3`;

    let outputUrl = "";
    // Verifica si el archivo ya existe en la carpeta temporal
    const filePathAPI = [BASE_URL_TMP, randomFilename].join("/");
    const filePath = [tmpDirectory, randomFilename].join("/");
    if (fs.existsSync(filePath)) {
      outputUrl = url.format({
        protocol: protocol,
        host: req.get("host"),
        pathname: filePathAPI,
      });
      return res.status(StatusCodes.OK).json({
        filename: randomFilename,
        url: outputUrl,
      });
    } else {
      // Caso contrario genera el archivo y vuelve a buscarlo
      await mergeAudioFiles(urls, randomFilename);

      if (fs.existsSync(filePath)) {
        const outputUrl = url.format({
          protocol: protocol,
          host: req.get("host"),
          pathname: filePathAPI,
        });

        return res.status(StatusCodes.OK).json({
          filename: randomFilename,
          url: outputUrl,
        });
      } else {
        throw new Error("No se pudo generar el archivo MP3.");
      }
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
};

/**
 * Realiza la fusión de archivos MP3 a partir de las URLs proporcionadas.
 * @param {string[]} urls - Lista de URLs de los archivos MP3 a fusionar.
 * @param {string} randomFilename - Nombre del archivo MP3 fusionado generado aleatoriamente.
 * @returns {Promise<void>} - Resuelve cuando la fusión de archivos se completa correctamente.
 */
const { exec } = require("child_process");
const util = require("util");
const execPromisified = util.promisify(exec);

async function mergeAudioFiles(urls: string[], randomFilename: string) {
  const outputFilePath = path.join(tmpDirectory, randomFilename);

  let command = urls.reduce((acc, file) => `${acc} -i "${file}"`, "ffmpeg");

  const filter =
    urls.length > 1 ? `-filter_complex concat=n=${urls.length}:v=0:a=1` : "";

  command += ` ${filter} "${outputFilePath}"`;

  try {
    const { stdout, stderr } = await execPromisified(command);

    if (stderr) {
      console.error(`Error: ${stderr}`);
    } else {
      console.log("Files merged successfully!");
    }
  } catch (error) {
    console.error(`Error merging files: ${error}`);
  }
}

export const SearchAnimeSentences = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // query: palabra/oración a buscar
    // cursor: número de página
    // limit: cantidad de resultados por página
    // anime_id: id del anime (en caso de algún filtro)
    // uuid: id del anime (para una busqueda de una oración en específico)
    // content_sort: ordenar por contenido (asc/desc/random)
    // random_seed: semilla para ordenar aleatoriamente. Obligatorio si content_sort = random
    const { query, cursor, limit, anime_id, uuid, content_sort, random_seed } =
      req.body;
    const offset = cursor ? cursor - 1 : 0;
    let results: any = null;

    let sql = "";
    let whereClause = "";

    // Orden por defecto
    let sort = "";
    if (content_sort) {
      if (
        content_sort.toLowerCase() === "asc" ||
        content_sort.toLowerCase() === "desc"
      ) {
        sort = ` ORDER BY v.content_length ${content_sort.toUpperCase()}`;
      } else if (content_sort.toLowerCase() === "random") {
        if (random_seed !== null || random_seed !== undefined) {
          sql = `SELECT setseed(${random_seed});`;
          await connection.query(sql);
          sort = ` ORDER BY random()`;
        } else {
          return res.status(StatusCodes.BAD_REQUEST).json({
            message:
              "You must provide a random seed to sort the results randomly. Values must be between -1 and 1",
          });
        }
      }
    }

    if (anime_id) {
      whereClause = ` AND me.id = ${anime_id} `;
    }

    if (query && !uuid) {
      sql =
        `
        WITH Variations AS (
          SELECT DISTINCT ON (s.content, s.uuid) variations.possible_highlights, s.*, ep.number as "episode", se.number as "season", me.english_name, me.japanese_name, me.banner, me.cover, me.folder_media_name, me.id as media_id
          FROM nadedb.public."Segment" s
          INNER JOIN nadedb.public."Episode" ep ON s."episodeId" = ep.id
          INNER JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
          INNER JOIN nadedb.public."Media" me ON se."mediaId" = me.id,
          LATERAL get_variations(s.content, '${query}') as variations
          WHERE (((s.content || '' )) &@~ ja_expand('${query}')
           OR (s.content || '' || '') &@~ ja_expand('${query}'))` +
        whereClause +
        `)
        SELECT pgroonga_highlight_html(v.content,
                                       v.possible_highlights) as content_highlight, v.*
        FROM Variations v${sort} LIMIT ${limit} OFFSET ${offset};
      `;
      results = await connection.query(sql);
    }

    const simplifiedResults = buildSimplifiedResults(req, results);

    const full_results_query =
      `WITH Variations AS (
        SELECT DISTINCT ON (s.content, s.uuid) variations.possible_highlights, s.*, ep.number as "episode", se.number as "season", me.english_name, me.japanese_name, me.folder_media_name, me.id as media_id
        FROM nadedb.public."Segment" s
        INNER JOIN nadedb.public."Episode" ep ON s."episodeId" = ep.id
        INNER JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
        INNER JOIN nadedb.public."Media" me ON se."mediaId" = me.id,
        LATERAL get_variations(s.content, '${query}') as variations
        WHERE (((s.content || '' )) &@~ ja_expand('${query}')
        OR (s.content || '' || '') &@~ ja_expand('${query}'))` +
      `)
      SELECT media_id, english_name, japanese_name, COUNT(*) AS sentence_count
      FROM Variations
      GROUP BY media_id, english_name, japanese_name;
    `;

    const full_results = await connection.query(full_results_query);

    let uniqueTitles = (full_results[0] as any[]).map((result) => ({
      anime_id: result["media_id"],
      name_anime_en: result["english_name"],
      name_anime_jp: result["japanese_name"],
      amount_sentences_found: result["sentence_count"],
    }));

    const nextCursor = cursor
      ? cursor + results[0].length
      : results[0].length + 1;

    return res.status(StatusCodes.ACCEPTED).json({
      statistics: uniqueTitles,
      sentences: simplifiedResults,
      cursor: nextCursor,
    });
  } catch (error) {
    next(error);
  }
};

export const GetContextAnime = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id_anime, season, episode, index_segment, limit } = req.body;

    let whereClause = ` WHERE me.id = ${id_anime} AND se.number = ${season} AND ep.number = ${episode} `;
    let sql =
      `
    WITH ordered_segments AS (
      SELECT s.*, ep.number as "episode", se.number as "season", 
        me.english_name, me.japanese_name, me.folder_media_name, me.id as media_id,
        ROW_NUMBER() OVER (ORDER BY s.position) as row_number
      FROM nadedb.public."Segment" s
      INNER JOIN nadedb.public."Episode" ep ON s."episodeId" = ep.id
      INNER JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
      INNER JOIN nadedb.public."Media" me ON se."mediaId" = me.id
      ` +
      whereClause +
      `
    ),
    target_segment AS (
      SELECT row_number
      FROM ordered_segments
      WHERE position = ${index_segment}
    ),
    context_segments AS (
      SELECT *
      FROM ordered_segments
      WHERE row_number BETWEEN (SELECT row_number FROM target_segment) - ${limit}
        AND (SELECT row_number FROM target_segment) + ${limit}
    )
    SELECT * FROM context_segments ORDER BY position;
    `;

    let results = await connection.query(sql);

    const simplifiedResults = buildSimplifiedResults(req, results);

    return res.status(StatusCodes.ACCEPTED).json({
      context: simplifiedResults,
    });
  } catch (error) {
    next(error);
  }
};

export const GetWordsMatched = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { words } = req.body;
    const wordsFormatted = words.map((word: string) => `'${word}'`).join(", ");

    const sql = `WITH words AS (
      SELECT UNNEST(ARRAY[${wordsFormatted}]) AS word
    ), Variations AS (
      SELECT 
        words.word,
        COALESCE(me.id, -1) AS mediaId,
        COALESCE(me.english_name, '') AS englishName,
        COALESCE(me.japanese_name, '') AS japaneseName,
        COALESCE(me.folder_media_name, '') AS folderMediaName,  
        COUNT(s.id) AS matches
      FROM 
        words
      LEFT JOIN LATERAL (
          SELECT s.*, get_variations(s.content, words.word) as variations
          FROM nadedb.public."Segment" s
          WHERE ((s.content || '' ) &@~ ja_expand(words.word)
              OR (s.content || '' || '') &@~ ja_expand(words.word))
        ) s ON true
      LEFT JOIN nadedb.public."Episode" ep ON s."episodeId" = ep.id
      LEFT JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
      LEFT JOIN nadedb.public."Media" me ON se."mediaId" = me.id
      GROUP BY 
        words.word, me.id, me.english_name, me.japanese_name, me.folder_media_name
    )
    SELECT 
      word, 
      (SUM(matches) > 0) AS is_match,
      SUM(matches) as total_matches,
      json_agg(
        json_build_object(
          'mediaId', mediaId, 
          'english_name', englishName,
          'japanese_name', japaneseName,
          'folder_media_name', folderMediaName,
          'matches', matches
        )
      ) FILTER (WHERE mediaId != -1) AS media
    FROM 
      Variations
    GROUP BY
      word`;

    const resultados = await connection.query(sql);

    return res.status(StatusCodes.ACCEPTED).json({
      results: resultados[0],
    });
  } catch (error) {
    next(error);
  }
};

export const GetAllAnimes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const sql = `SELECT 
        json_build_object(
          'created_at', me.created_at,
          'updated_at', me.updated_at,
          'romaji_name', me.romaji_name,
          'english_name', me.english_name, 
          'japanese_name', me.japanese_name,
          'airing_format', me.airing_format,
          'airing_status', me.airing_status,
          'genres', me.genres,
          'cover', me.cover,
          'banner', me.banner,
          'version', me.version
        ) AS media_info,
        (
          SELECT json_agg(
            json_build_object(
              'season', se.number,
              'total_segments_season', (
                SELECT COUNT(s.id)
                FROM nadedb.public."Segment" s
                WHERE s."episodeId" IN (
                  SELECT ep.id FROM nadedb.public."Episode" ep WHERE se.id = ep."seasonId"
                )
              ),
              'episodes', (
                SELECT json_agg(
                  json_build_object(
                    'episode', ep.number,
                    'total_segments_episode', (
                      SELECT COUNT(s.id)
                      FROM nadedb.public."Segment" s
                      WHERE ep.id = s."episodeId"
                    )
                  )
                )
                FROM nadedb.public."Episode" ep
                WHERE se.id = ep."seasonId"
              )
            )
          )
          FROM nadedb.public."Season" se
          WHERE me.id = se."mediaId"
        ) AS media_available,
        (
          SELECT COUNT(s.id)
          FROM nadedb.public."Segment" s
          WHERE s."episodeId" IN (
            SELECT ep.id 
            FROM nadedb.public."Episode" ep
            JOIN nadedb.public."Season" se ON ep."seasonId" = se.id
            WHERE se."mediaId" = me.id
          )
        ) AS total_segments_media
      FROM 
        nadedb.public."Media" me
      GROUP BY 
        me.id, me.romaji_name, me.english_name, me.japanese_name
      ORDER BY me.created_at DESC`;

    let protocol: string = "";
    if (process.env.ENVIRONMENT === "production") {
      protocol = "https";
    } else if (process.env.ENVIRONMENT == "testing") {
      protocol = "http";
    }

    const resultados = await connection.query(sql);
    // modify the results to include the full URLs for cover and banner
    (resultados[0] as any[]).forEach((result) => {
      result.media_info.cover = url.format({
        protocol: protocol,
        host: req.get("host"),
        pathname: [BASE_URL_MEDIA, result.media_info.cover].join("/"),
      });
      result.media_info.banner = url.format({
        protocol: protocol,
        host: req.get("host"),
        pathname: [BASE_URL_MEDIA, result.media_info.banner].join("/"),
      });
    });

    return res.status(StatusCodes.ACCEPTED).json({
      results: resultados[0],
    });
  } catch (error) {
    next(error);
  }
};

function buildSimplifiedResults(req: Request, results: any) {
  let protocol: string = "";
  if (process.env.ENVIRONMENT === "production") {
    protocol = "https";
  } else if (process.env.ENVIRONMENT == "testing") {
    protocol = "http";
  }
  return (results[0] as any[]).map((result) => {
    const seriesNamePath = result["folder_media_name"];
    const seasonNumberPath = `S${result["season"].toString().padStart(2, "0")}`;
    const episodeNumberPath = `E${result["episode"]
      .toString()
      .padStart(2, "0")}`;

    return {
      basic_info: {
        id_anime: result["media_id"],
        name_anime_ro: result["romaji_name"],
        name_anime_en: result["english_name"],
        name_anime_jp: result["japanese_name"],
        airing_format: result["airing_format"],
        airing_status: result["airing_status"],
        genres: result["genres"],
        cover: url.format({
          protocol: protocol,
          host: req.get("host"),
          pathname: [BASE_URL_MEDIA, result["cover"]].join("/"),
        }),
        banner: url.format({
          protocol: protocol,
          host: req.get("host"),
          pathname: [BASE_URL_MEDIA, result["banner"]].join("/"),
        }),
        version: result["version"],
        season: result["season"],
        episode: result["episode"],
      },
      segment_info: {
        uuid: result["uuid"],
        position: result["position"],
        start_time: result["start_time"],
        end_time: result["end_time"],
        content_jp: result["content"],
        content_highlight: result["content_highlight"],
        content_en: result["content_english"],
        content_en_mt: result["content_english_mt"] || true,
        content_es: result["content_spanish"],
        content_es_mt: result["content_spanish_mt"] || true,
        actor_ja: result["actor_ja"],
        actor_es: result["actor_es"],
        actor_en: result["actor_en"],
      },
      media_info: {
        path_image: url.format({
          protocol: protocol,
          host: req.get("host"),
          pathname: [
            BASE_URL_MEDIA,
            seriesNamePath,
            seasonNumberPath,
            episodeNumberPath,
            result["path_image"],
          ].join("/"),
        }),
        path_audio: url.format({
          protocol: protocol,
          host: req.get("host"),
          pathname: [
            BASE_URL_MEDIA,
            seriesNamePath,
            seasonNumberPath,
            episodeNumberPath,
            result["path_audio"],
          ].join("/"),
        }),
      },
    };
  });
}
