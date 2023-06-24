import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { Segment } from "../models/media/segment";
import { Media } from "../models/media/media";
import { Episode } from "../models/media/episode";
import { Season } from "../models/media/season";
import { Op, Sequelize } from "sequelize";

const ffmpegStatic = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegStatic);
var ffprobe = require("ffprobe-static");
ffmpeg.setFfprobePath(ffprobe.path);

const BASE_URL_MEDIA = process.env.BASE_URL_MEDIA;
const BASE_URL_TMP = process.env.BASE_URL_TMP;

export const mergeMp3Files = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const urls = req.body.urls;
  if (!urls) throw new BadRequest("Debe ingresar una lista de urls.");

  try {
    const ffmpegCommand = ffmpeg();

    urls.forEach((url: any, index: number) => {
      ffmpegCommand.input(url);

      // Agregar el tiempo de silencio de 2 segundos (2000 milisegundos) excepto para el último archivo
      if (index < urls.length - 1) {
        ffmpegCommand
          .input("anullsrc=cl=stereo:r=44100:d=0.2")
          .inputFormat("lavfi");
      }
    });

    await new Promise((resolve, reject) => {
      ffmpegCommand
        .on("end", resolve)
        .on("error", reject)
        .mergeToFile("./media/tmp/output.mp3");
    })
      .then(() => {
        console.log("La conversión se ha completado exitosamente");
        return res.status(StatusCodes.OK).json({
          message: "La conversión se ha completado exitosamente",
          url: `${BASE_URL_TMP}/output.mp3`,
        });
      })
      .catch((error) => {
        console.error("Se produjo un error durante la conversión:", error);
      });
  } catch (error) {
    next(error);
  }
};

export const SearchAnimeSentences = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { query, cursor, limit, anime_id, uuid } = req.body;

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
          Sequelize.literal(`(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}' `),
        ],
      };
      whereClauseTempo = {
        [Op.or]: [Sequelize.literal(`(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`)],
      };
    } else {
      if (!query) throw new BadRequest("Debe ingresar un término a buscar.");
      (whereClause = cursor
        ? {
            [Op.or]: [Sequelize.literal(`(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`)],
            position: { [Op.gt]: cursor },
          }
        : Sequelize.literal(`(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`)),
        (whereClauseTempo = {
          [Op.or]: [Sequelize.literal(`(content || '') &@~ '${query}' OR (content || '' || '') &@~ '${query}'`)],
        });
    }

    let whereClause2 = {};
    if (anime_id) {
      whereClause2 = {
        id: anime_id,
      };
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
      order: [["position", "ASC"]],
      limit: limit,
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

    const simplifiedResults = results.map((result) => ({
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
        content_es: result.content_spanish,
      },
      media_info: {
        path_image: `${BASE_URL_MEDIA}/${
          escape(result.episode.season.media.english_name)
        }/S${String("0" + result.episode.season.number).slice(-2)}/${String(
          "0" + result.episode.number
        ).slice(-2)}/${escape(result.path_image)}`,
        path_audio: `${BASE_URL_MEDIA}/${
          escape(result.episode.season.media.english_name)
        }/S${String("0" + result.episode.season.number).slice(-2)}/${String(
          "0" + result.episode.number
        ).slice(-2)}/${escape(result.path_audio)}`,
      },
    }));

    const nextCursor =
      results.length > 0 ? results[results.length - 1].position : null;

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

    const simplifiedResults = results.map((result) => ({
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
        content_es: result.content_spanish,
      },
      media_info: {
        path_image: `${BASE_URL_MEDIA}/${
          result.episode.season.media.english_name
        }/S${String("0" + result.episode.season.number).slice(-2)}/${String(
          "0" + result.episode.number
        ).slice(-2)}/${result.path_image}`,
        path_audio: `${BASE_URL_MEDIA}/${
          result.episode.season.media.english_name
        }/S${String("0" + result.episode.season.number).slice(-2)}/${String(
          "0" + result.episode.number
        ).slice(-2)}/${result.path_audio}`,
      },
    }));

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
