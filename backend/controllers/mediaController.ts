import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { Segment } from "../models/media/segment";
import { Media } from "../models/media/media";
import { Episode } from "../models/media/episode";
import { Season } from "../models/media/season";
import { Op, Sequelize } from "sequelize";
import { v3 as uuidv3 } from "uuid";
import url from "url";
import fs from "fs";

const ffmpegStatic = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegStatic);
var ffprobe = require("ffprobe-static");
ffmpeg.setFfprobePath(ffprobe.path);

const BASE_URL_MEDIA = process.env.BASE_URL_MEDIA;
const BASE_URL_TMP = process.env.BASE_URL_TMP;
const tempDirectory: string = process.env.TEMP_DIRECTORY!;

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
    const filePath = [tempDirectory, randomFilename].join("/");
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
      await mergeMp3Files(urls, randomFilename);

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
export const mergeMp3Files = async (urls: string[], randomFilename: string) => {
  try {
    const ffmpegCommand = ffmpeg();
    urls.forEach((url: string) => {
      ffmpegCommand.input(url);
    });

    await new Promise<void>((resolve, reject) => {
      ffmpegCommand
        .on("end", resolve)
        .on("error", reject)
        .mergeToFile([tempDirectory, randomFilename].join("/"));
    });
  } catch (error) {
    console.error("Se produjo un error durante la conversión:", error);
  }
};

export const SearchAnimeSentences = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { query, cursor, limit, anime_id, uuid, content_sort } = req.body;

    const offset = cursor ? cursor - 1 : 0;

    let whereClause = {};
    let whereClauseTempo = {};

    if (uuid && !query) {
      whereClause = { uuid: { [Op.eq]: uuid } };
      whereClauseTempo = {
        content: { [Op.like]: `%${query}%` },
        uuid: { [Op.eq]: uuid },
      };
    } else if (query && uuid) {
      whereClause = {
        [Op.or]: [
          { uuid: { [Op.eq]: uuid } },
          Sequelize.literal(
            `(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}' `
          ),
        ],
      };
      whereClauseTempo = {
        [Op.or]: [
          Sequelize.literal(
            `(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`
          ),
        ],
      };
    } else {
      if (!query) throw new BadRequest("Debe ingresar un término a buscar.");
      (whereClause = cursor
        ? {
            [Op.or]: [
              Sequelize.literal(
                `(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`
              ),
            ],
          }
        : Sequelize.literal(
            `(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`
          )),
        (whereClauseTempo = {
          [Op.or]: [
            Sequelize.literal(
              `(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`
            ),
          ],
        });
    }

    let whereClause2 = {};
    if (anime_id) {
      whereClause2 = {
        id: anime_id,
      };
    }

    let order: string[][] = [];
    if (content_sort) {
      if (content_sort.toLowerCase() == "asc") {
        order = [["content_length", "ASC"]];
      } else if (content_sort.toLowerCase() == "desc") {
        order = [["content_length", "DESC"]];
      }
    }

    const results = await Segment.findAll({
      where: whereClause,
      include: [
        {
          model: Episode,
          required: true,
          include: [
            {
              model: Season,
              required: true,
              include: [
                {
                  model: Media,
                  required: true,
                  where: whereClause2,
                },
              ],
            },
          ],
        },
      ],
      // @ts-ignore
      order: order,
      limit: limit,
      offset: offset,
    });

    // Get total number of results without limit
    const results_temp = await Segment.findAll({
      where: whereClauseTempo,
      include: [
        {
          model: Episode,
          required: true,
          include: [
            {
              model: Season,
              required: true,
              include: [
                {
                  model: Media,
                  required: true,
                },
              ],
            },
          ],
        },
      ],
      order: [["position", "ASC"]],
    });

    let uniqueTitles = results_temp.reduce(
      (titles: { [key: string]: any }, item) => {
        const animeTitle = item?.episode?.season?.media?.english_name;
        const animeId = item?.episode?.season?.media?.id;

        if (animeTitle) {
          if (!titles.hasOwnProperty(animeTitle)) {
            titles[animeTitle] = {
              amount_sentences_found: 0,
              ids: [],
            };
          }
          titles[animeTitle].amount_sentences_found++;
          titles[animeTitle].ids.push(animeId);
        }
        return titles;
      },
      {}
    );

    uniqueTitles = Object.entries(uniqueTitles).map(([anime, data]) => ({
      anime_id: data?.ids[0],
      name_anime_en: anime,
      amount_sentences_found: data?.amount_sentences_found,
    }));

    if (!results)
      throw new NotFound("No se han encontrado palabras en la base de datos.");

    const simplifiedResults = buildSimplifiedResults(req, results);

    const nextCursor = cursor ? cursor + results.length : results.length + 1;

    return res.status(StatusCodes.ACCEPTED).json({
      sentences: simplifiedResults,
      statistics: uniqueTitles,
      cursor: nextCursor,
    });
  } catch (error) {
    return next(error);
  }
};

export const GetContextAnime = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id_anime, season, episode, index_segment, limit } = req.body;

    let results = await Segment.findAll({
      include: [
        {
          model: Episode,
          required: true,
          where: {
            number: episode,
          },
          include: [
            {
              model: Season,
              required: true,
              where: {
                number: season,
              },
              include: [
                {
                  model: Media,
                  where: {
                    id: id_anime,
                  },
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    });

    const simplifiedResults = buildSimplifiedResults(req, results);

    let limitedResults;

    if (limit) {
      limitedResults = simplifiedResults
        .filter(
          (result) =>
            Math.abs(result.segment_info.position - index_segment) <= limit
        )
        .sort((a, b) => a.segment_info.position - b.segment_info.position);
    } else {
      limitedResults = simplifiedResults.sort(
        (a, b) => a.segment_info.position - b.segment_info.position
      );
    }

    return res.status(StatusCodes.ACCEPTED).json({
      context: limitedResults,
    });
  } catch (error) {
    next(error);
  }
};

function buildSimplifiedResults(req: Request, results: Segment[]) {
  let protocol: string = "";
  if (process.env.ENVIRONMENT === "production") {
    protocol = "https";
  } else if (process.env.ENVIRONMENT == "testing") {
    protocol = "http";
  }
  return results.map((result) => {
    const seriesNamePath = result.episode.season.media.folder_media_name;
    const seasonNumberPath = `S${result.episode.season.number
      .toString()
      .padStart(2, "0")}`;
    const episodeNumberPath = `E${result.episode.number
      .toString()
      .padStart(2, "0")}`;

    return {
      basic_info: {
        id_anime: result.episode.season.media.id,
        name_anime_en: result.episode.season.media.english_name,
        name_anime_jp: result.episode.season.media.japanese_name,
        season: result.episode.season.number,
        episode: result.episode.number,
      },
      segment_info: {
        uuid: result.uuid,
        position: result.position,
        start_time: result.start_time,
        end_time: result.end_time,
        content_jp: result.content,
        content_en: result.content_english,
        content_en_mt: result.content_english_mt || true,
        content_es: result.content_spanish,
        content_es_mt: result.content_spanish_mt || true,
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
            result.path_image,
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
            result.path_audio,
          ].join("/"),
        }),
      },
    };
  });
}
