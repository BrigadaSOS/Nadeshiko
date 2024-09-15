import { BadRequest, NotFound } from "../utils/error";
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
const requestIp = require('request-ip');

import {querySegments, querySurroundingSegments, queryWordsMatched} from "../external/elasticsearch";
import {queryMediaInfo} from "../external/database_queries";
import {QueryMediaInfoResponse} from "../models/external/queryMediaInfoResponse";
import {GetAllAnimesResponse} from "../models/controller/GetAllAnimesResponse";
import {SearchAnimeSentencesRequest} from "../models/controller/SearchAnimeSentencesRequest";
import {ControllerRequest, ControllerResponse, getBaseUrlMedia, getBaseUrlTmp} from "../utils/utils";
import {SearchAnimeSentencesResponse} from "../models/controller/SearchAnimeSentencesResponse";
import {GetWordsMatchedRequest} from "../models/controller/GetWordsMatchedRequest";
import {GetWordsMatchedResponse} from "../models/controller/GetWordsMatchedResponse";
import {GetAllAnimesRequest} from "../models/controller/GetAllAnimesRequest";
import {GetContextAnimeRequest} from "../models/controller/GetContextAnimeRequest";
import {GetContextAnimeResponse} from "../models/controller/GetContextAnimeResponse";
import { SaveUserSearchHistory } from "./databaseController";
import { EventTypeHistory } from "../models/miscellaneous/userSearchHistory"
import { Segment } from "../models/media/segment";
import { CategoryType } from "../models/media/media"

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

    if(!req.body.query && !req.body.uuid) throw new BadRequest("Missing query")

    const response = await querySegments({
      query: req.body.query,
      uuid: req.body.uuid,
      length_sort_order: req.body.content_sort || "none",
      limit: req.body.limit || 10,
      status: req.body.status || [1],
      cursor: req.body.cursor,
      random_seed: req.body.random_seed,
      media: req.body.media,
      anime_id: req.body.anime_id,
      exact_match: req.body.exact_match,
      season: req.body.season,
      episode: req.body.episode,
      category: req.body.category || [1,2,3],
      extra: req.body.extra || false
    });

    if(!req.body.cursor){
      const hits = response.statistics.reduce((total, item) => { return total + item.amount_sentences_found;}, 0);
      await SaveUserSearchHistory(EventTypeHistory.SEARCH_MAIN_QUERY_TEXT, req.body.query, requestIp.getClientIp(req), hits);
    }

    return res.status(StatusCodes.OK).json(response);

  } catch (error) {
    next(error);
  }
};

export const GetContextAnime = async (
  req: ControllerRequest<GetContextAnimeRequest>,
  res: ControllerResponse<GetContextAnimeResponse>,
  next: NextFunction
) => {
  try {
    const response = await querySurroundingSegments(req.body);

    return res.status(StatusCodes.ACCEPTED).json(response);
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
    const { words, exact_match } = req.body;

    const response = await queryWordsMatched(words, exact_match);
    return res.status(StatusCodes.OK).json(response);

  } catch (error) {
    next(error);
  }
};

export const getAllMedia = async (
  req: ControllerRequest<void, GetAllAnimesRequest>,
  res: ControllerResponse<GetAllAnimesResponse>,
  next: NextFunction
) => {
  try {
    const pageSize = parseInt(req.query.size as string) || 20;
    const searchQuery = typeof req.query.query === 'string' ? req.query.query : '';
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : 0;
    const type = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : ''; 

    const response: QueryMediaInfoResponse = await queryMediaInfo();

    let results = Object.values(response.results);

    const categoryMap: Record<string, CategoryType> = {
      anime: CategoryType.ANIME,
      liveaction: CategoryType.JDRAMA,
    };

    if (type && categoryMap[type]) {
      const selectedCategory = categoryMap[type];
      results = results.filter((media) => media.category === selectedCategory);
    }

    if (searchQuery) {
      results = results.filter(
        (media) =>
          media.english_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          media.japanese_name.includes(searchQuery)
      );
    }

    const paginatedResults = results.slice(cursor, cursor + pageSize);
    const nextCursor = cursor + pageSize;
    const hasMoreResults = nextCursor < results.length;

    return res.status(StatusCodes.OK).json({
      stats: response.stats,
      results: paginatedResults,
      cursor: hasMoreResults ? nextCursor : null,
      hasMoreResults: hasMoreResults
    });
    
  } catch (error) {
    next(error);
  }
};

export const updateSegment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {

    const { content_en, content_es, content_jp, isNSFW, uuid } = req.body;

    const segment = await Segment.findOne({
      where: { uuid: uuid },
    });

    if (!segment) {
      throw new NotFound("Segment not found.");
    }

    if (content_en) {
      segment.content_english = content_en;
    }

    if(content_es) {
      segment.content_spanish = content_es
    }

    if(content_jp) {
      segment.content = content_jp
      segment.content_length = content_jp.length
    }

    if(isNSFW) {
      segment.is_nsfw = isNSFW
    }

    await segment.save();

    // Responder al cliente
    return res.status(StatusCodes.OK).json({
      message: "Segment updated successfully."
    });
  } catch (error) {
    return next(error);
  }
};
