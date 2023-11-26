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
      exact_match: req.body.exact_match
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
    const { words } = req.body;

    const response = await queryWordsMatched(words);
    return res.status(StatusCodes.OK).json(response);

  } catch (error) {
    next(error);
  }
};

export const GetAllAnimes = async (
  req: ControllerRequest<void, GetAllAnimesRequest>,
  res: ControllerResponse<GetAllAnimesResponse>,
  next: NextFunction
) => {
  try {
    const response: QueryMediaInfoResponse = await queryMediaInfo();

    let results = [];
    if(req.query.sorted && req.query.sorted.toLowerCase() === "true") {
      results = Object.values(response.results).sort((a, b) => {return Date.parse(b.created_at) - Date.parse(a.created_at) })
    } else {
      results = Object.values(response.results)
    }

    if(req.query.size && Number(req.query.size) >= 0) {
      results = results.slice(0, Number(req.query.size));
    }

    return res.status(StatusCodes.ACCEPTED).json({
      stats: response.stats,
      results
    });

  } catch (error) {
    next(error);
  }
};