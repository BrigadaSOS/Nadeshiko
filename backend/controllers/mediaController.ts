import { BadRequest } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { v3 as uuidv3 } from "uuid";
import connection from "../database/db_posgres";

import path from "path";
import fs from "fs";

const { exec } = require("child_process");
const util = require("util");
const execPromisified = util.promisify(exec);
const ffmpegStatic = require('ffmpeg-static');

import {querySegments, queryWordsMatched} from "../external/elasticsearch";
import {queryMediaInfo} from "../external/database_queries";
import {QueryMediaInfoResponse} from "../models/external/queryMediaInfoResponse";
import {GetAllAnimesResponse} from "../models/controller/GetAllAnimesResponse";
import {SearchAnimeSentencesRequest} from "../models/controller/SearchAnimeSentencesRequest";
import {ControllerRequest, ControllerResponse, getBaseUrlMedia, getBaseUrlTmp} from "../utils/utils";
import {SearchAnimeSentencesResponse} from "../models/controller/SearchAnimeSentencesResponse";
import {GetWordsMatchedRequest} from "../models/controller/GetWordsMatchedRequest";
import {GetWordsMatchedResponse} from "../models/controller/GetWordsMatchedResponse";
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
    const filePathAPI = [getBaseUrlTmp(), randomFilename].join("/");
    const filePath = [tmpDirectory, randomFilename].join("/");
    if (fs.existsSync(filePath)) {
      return res.status(StatusCodes.OK).json({
        filename: randomFilename,
        url: filePathAPI,
      });
    } else {
      // Caso contrario genera el archivo y vuelve a buscarlo
      await mergeAudioFiles(urls, randomFilename);

      if (fs.existsSync(filePath)) {
        return res.status(StatusCodes.OK).json({
          filename: randomFilename,
          url: filePathAPI,
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

async function mergeAudioFiles(urls: string[], randomFilename: string) {
  const outputFilePath = path.join(tmpDirectory, randomFilename);

  let command = urls.reduce((acc, file) => `${acc} -i "${file}"`, `${ffmpegStatic}`);

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
  req: ControllerRequest<SearchAnimeSentencesRequest>,
  res: ControllerResponse<SearchAnimeSentencesResponse>,
  next: NextFunction
) => {
  try {
    const { query, cursor, limit, anime_id, uuid, content_sort, random_seed } =
      req.body;

    // TODO: Add sorting and random results

    const response = await querySegments(query, uuid, anime_id, limit, cursor);
    return res.status(StatusCodes.OK).json(response);

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

    let whereClause = ` WHERE me.id = ${id_anime} AND s.season = ${season} AND s.episode = ${episode} AND s.status = 1`;
    let sql =
      `
    WITH ordered_segments AS (
      SELECT s.*, me.english_name, me.japanese_name, me.folder_media_name, me.id, ROW_NUMBER() OVER (ORDER BY s.position) as row_number
      FROM nadedb.public."Segment" s
      INNER JOIN nadedb.public."Media" me ON s."media_id" = me.id
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
  req: ControllerRequest<GetWordsMatchedRequest>,
  res: ControllerResponse<GetWordsMatchedResponse>,
  next: NextFunction
) => {
  try {
    const { words } = req.body;

    const response = await queryWordsMatched(words);
    return res.status(StatusCodes.OK).json(response);

  } catch (error) {
    next(error);
  }
};

export const GetAllAnimes = async (
  _: ControllerRequest<void>,
  res: ControllerResponse<GetAllAnimesResponse>,
  next: NextFunction
) => {
  try {
    const response: QueryMediaInfoResponse = await queryMediaInfo();

    return res.status(StatusCodes.ACCEPTED).json(response);

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
        cover: [getBaseUrlMedia(), result["cover"]].join("/"),
        banner: [getBaseUrlMedia(), result["banner"]].join("/"),
        version: result["version"],
        season: result["season"],
        episode: result["episode"],
      },
      segment_info: {
        status: result["status"],
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
        path_image: [
          getBaseUrlMedia(),
          seriesNamePath,
          seasonNumberPath,
          episodeNumberPath,
          result["path_image"],
        ].join("/"),
        path_audio: [
          getBaseUrlMedia(),
          seriesNamePath,
          seasonNumberPath,
          episodeNumberPath,
          result["path_audio"],
        ].join("/")
      },
    };
  });
}
