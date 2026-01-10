import { BadRequest, NotFound } from '../utils/error';
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { v3 as uuidv3 } from 'uuid';
import { logger } from '../utils/log';

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import requestIp from 'request-ip';

import { querySegments, querySurroundingSegments, queryWordsMatched } from '../external/elasticsearch';
import { queryMediaInfo } from '../external/database_queries';
import { MediaInfoStats } from '../models/external/queryMediaInfoResponse';
import { GetAllAnimesResponse } from '../models/controller/GetAllAnimesResponse';
import { SearchAnimeSentencesRequest } from '../models/controller/SearchAnimeSentencesRequest';
import { ControllerRequest, ControllerResponse, getBaseUrlMedia, getBaseUrlTmp } from '../utils/utils';
import { SearchAnimeSentencesResponse } from '../models/controller/SearchAnimeSentencesResponse';
import { GetWordsMatchedRequest } from '../models/controller/GetWordsMatchedRequest';
import { GetWordsMatchedResponse } from '../models/controller/GetWordsMatchedResponse';
import { GetAllAnimesRequest } from '../models/controller/GetAllAnimesRequest';
import { GetContextAnimeRequest } from '../models/controller/GetContextAnimeRequest';
import { GetContextAnimeResponse } from '../models/controller/GetContextAnimeResponse';
import { SaveUserSearchHistory } from './databaseController';
import { EventTypeHistory } from '../models/miscellaneous/userSearchHistory';
import { Segment } from '../models/media/segment';
import { CategoryType, Media } from '../models/media/media';
import { Op } from 'sequelize';

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
export const generateURLAudio = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const urls: string[] = req.body.urls || [];

    if (!Array.isArray(urls) || urls.length === 0) {
      throw new BadRequest('Debe ingresar una lista de URLs MP3.');
    }

    const urlHash = urls.join('');

    const randomFilename = `${uuidv3(urlHash, process.env.UUID_NAMESPACE!)}.mp3`;
    // Verifica si el archivo ya existe en la carpeta temporal
    const filePathAPI = [getBaseUrlTmp(), randomFilename].join('/');
    const filePath = [tmpDirectory, randomFilename].join('/');
    if (fs.existsSync(filePath)) {
      res.status(StatusCodes.OK).json({
        filename: randomFilename,
        url: filePathAPI,
      });
      return;
    } else {
      // Caso contrario genera el archivo y vuelve a buscarlo
      await mergeAudioFiles(urls, randomFilename);

      if (fs.existsSync(filePath)) {
        return res.status(StatusCodes.OK).json({
          filename: randomFilename,
          url: filePathAPI,
        });
      } else {
        throw new Error('No se pudo generar el archivo MP3.');
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Audio URL generation failed');
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

  // Build ffmpeg arguments as array.
  const ffmpegArgs: string[] = [];

  // Add each input as a separate -i argument
  for (const file of urls) {
    ffmpegArgs.push('-i', file);
  }

  if (urls.length > 1) {
    ffmpegArgs.push('-filter_complex', `concat=n=${urls.length}:v=0:a=1`);
  }

  ffmpegArgs.push(outputFilePath);

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegStatic || 'ffmpeg', ffmpegArgs, { stdio: 'inherit' });
      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          logger.info({ outputFilePath, urlCount: urls.length }, 'Files merged successfully');
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
      ffmpeg.on('error', (error: Error) => {
        reject(error);
      });
    });
  } catch (error) {
    logger.error({ err: error, urls, outputFilePath }, 'Error merging audio files');
  }
}

export const SearchAnimeSentences = async (
  req: ControllerRequest<SearchAnimeSentencesRequest>,
  res: ControllerResponse<SearchAnimeSentencesResponse>,
  next: NextFunction,
) => {
  try {

    const response = await querySegments({
      query: req.body.query,
      uuid: req.body.uuid,
      length_sort_order: req.body.content_sort || 'none',
      limit: req.body.limit || 10,
      status: req.body.status || [1],
      cursor: req.body.cursor,
      random_seed: req.body.random_seed,
      media: req.body.media,
      anime_id: req.body.anime_id,
      exact_match: req.body.exact_match,
      season: req.body.season,
      episode: req.body.episode,
      category: req.body.category || [1, 2, 3, 4],
      extra: req.body.extra || false,
      min_length: req.body.min_length,
      max_length: req.body.max_length,
      excluded_anime_ids: req.body.excluded_anime_ids || [],
    });

    if (!req.body.cursor && req.body.query) {
      const hits = response.statistics.reduce((total, item) => {
        return total + item.amount_sentences_found;
      }, 0);
      await SaveUserSearchHistory(
        EventTypeHistory.SEARCH_MAIN_QUERY_TEXT,
        req.body.query,
        requestIp.getClientIp(req),
        hits,
      );
    }

    res.status(StatusCodes.OK).json(response);
  } catch (error) {
    next(error);
  }
};

export const SearchAnimeSentencesHealth = async (
  req: ControllerRequest<SearchAnimeSentencesRequest>,
  res: ControllerResponse<SearchAnimeSentencesResponse>,
  next: NextFunction,
) => {
  try {
    const response = await querySegments({
      query: 'あ',
      uuid: req.body.uuid,
      length_sort_order: req.body.content_sort || 'none',
      limit: req.body.limit || 10,
      status: req.body.status || [1],
      cursor: req.body.cursor,
      random_seed: req.body.random_seed,
      media: req.body.media,
      anime_id: req.body.anime_id,
      exact_match: req.body.exact_match,
      season: req.body.season,
      episode: req.body.episode,
      category: req.body.category || [1, 2, 3, 4],
      extra: req.body.extra || false,
      min_length: req.body.min_length,
      max_length: req.body.max_length,
      excluded_anime_ids: req.body.excluded_anime_ids || [],
    });

    res.status(StatusCodes.OK).json(response);
  } catch (error) {
    next(error);
  }
};

export const GetContextAnime = async (
  req: ControllerRequest<GetContextAnimeRequest>,
  res: ControllerResponse<GetContextAnimeResponse>,
  next: NextFunction,
) => {
  try {
    const response = await querySurroundingSegments(req.body);

    res.status(StatusCodes.ACCEPTED).json(response);
  } catch (error) {
    next(error);
  }
};

export const GetWordsMatched = async (
  req: ControllerRequest<GetWordsMatchedRequest>,
  res: ControllerResponse<GetWordsMatchedResponse>,
  next: NextFunction,
) => {
  try {
    const { words, exact_match } = req.body;

    const response = await queryWordsMatched(words, exact_match);
    res.status(StatusCodes.OK).json(response);
  } catch (error) {
    next(error);
  }
};

export const getAllMedia = async (
  req: ControllerRequest<void, GetAllAnimesRequest>,
  res: ControllerResponse<GetAllAnimesResponse>,
  next: NextFunction,
) => {
  try {
    const pageSize = parseInt(req.query.size as string) || 20;
    const searchQuery = typeof req.query.query === 'string' ? req.query.query : '';
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : 0;
    const type = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : '';

    const page = Math.floor(cursor / pageSize) + 1;

    const categoryMap: Record<string, CategoryType> = {
      anime: CategoryType.ANIME,
      liveaction: CategoryType.JDRAMA,
      audiobook: CategoryType.AUDIOBOOK,
    };

    const whereClause: any = {};
    if (type && categoryMap[type]) {
      whereClause.category = categoryMap[type];
    }

    if (searchQuery) {
      whereClause[Op.or] = [
        { english_name: { [Op.iLike]: `%${searchQuery}%` } },
        { japanese_name: { [Op.iLike]: `%${searchQuery}%` } },
        { romaji_name: { [Op.iLike]: `%${searchQuery}%` } },
      ];
    }

    const { count, rows } = await Media.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: cursor,
    });

    const mediaInfo = await queryMediaInfo(page, pageSize);

    const paginatedResults = rows.map((media) => {
      const mediaData = media.toJSON();
      const location_media =
        mediaData.category === CategoryType.ANIME
          ? 'anime'
          : mediaData.category === CategoryType.JDRAMA
            ? 'jdrama'
            : 'audiobook';
      mediaData.cover = [getBaseUrlMedia(), location_media, mediaData.cover].join('/');
      mediaData.banner = [getBaseUrlMedia(), location_media, mediaData.banner].join('/');
      return mediaData;
    });

    const nextCursor = cursor + paginatedResults.length;
    const hasMoreResults = nextCursor < count;

    const stats: MediaInfoStats = {
      total_animes: count,
      total_segments: paginatedResults.reduce((sum, media) => sum + media.num_segments, 0),
      full_total_animes: mediaInfo.stats.full_total_animes,
      full_total_segments: mediaInfo.stats.full_total_segments,
    };

    const response: GetAllAnimesResponse = {
      stats,
      results: paginatedResults,
      cursor: hasMoreResults ? nextCursor : null,
      hasMoreResults,
    };

    res.status(StatusCodes.OK).json(response);
  } catch (error) {
    next(error);
  }
};

export const updateSegment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content_en, content_es, content_jp, isNSFW, uuid } = req.body;

    const segment = await Segment.findOne({
      where: { uuid: uuid },
    });

    if (!segment) {
      throw new NotFound('Segment not found.');
    }

    if (content_en) {
      segment.content_english = content_en;
    }

    if (content_es) {
      segment.content_spanish = content_es;
    }

    if (content_jp) {
      segment.content = content_jp;
      segment.content_length = content_jp.length;
    }

    if (isNSFW) {
      segment.is_nsfw = isNSFW;
    }

    await segment.save();

    // Responder al cliente
    res.status(StatusCodes.OK).json({
      message: 'Segment updated successfully.',
    });
  } catch (error) {
    next(error);
  }
};
