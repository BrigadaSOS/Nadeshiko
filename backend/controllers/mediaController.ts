import { BadRequest, NotFound } from '../utils/error';
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { v3 as uuidv3 } from 'uuid';
import { logger } from '../utils/log';

import path from 'path';
import { existsSync } from '../utils/fs';
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
 * Generates a URL with access to the MP3 file.
 * First, a HASH is generated based on the provided URLs. The HASH is the name of the MP3 file.
 * If not found in the tmp folder, it proceeds to merge the URLs and generates the MP3 file.
 * Returns the URL of the generated/found MP3 file.
 * @param  {Request} req - Request with the URLs to process.
 * @param  {Response} res - Response with the URL of the generated/found MP3 file.
 * @returns {Promise<Response>} - Returns the URL of the generated/found MP3 file.
 */
export const generateURLAudio = async (req: Request, res: Response) => {
  const urls: string[] = req.body.urls || [];

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new BadRequest('You must enter a list of MP3 URLs.');
  }

  const urlHash = urls.join('');

  const randomFilename = `${uuidv3(urlHash, process.env.UUID_NAMESPACE!)}.mp3`;
  // Check if the file already exists in the temporary folder
  const filePathAPI = [getBaseUrlTmp(), randomFilename].join('/');
  const filePath = [tmpDirectory, randomFilename].join('/');
  if (existsSync(filePath)) {
    res.status(StatusCodes.OK).json({
      filename: randomFilename,
      url: filePathAPI,
    });
    return;
  } else {
    // Otherwise, generates the file and searches again
    await mergeAudioFiles(urls, randomFilename);

    if (existsSync(filePath)) {
      return res.status(StatusCodes.OK).json({
        filename: randomFilename,
        url: filePathAPI,
      });
    } else {
      throw new Error('Could not generate the MP3 file.');
    }
  }
};

/**
 * Performs the merging of MP3 files from the provided URLs.
 * @param {string[]} urls - List of URLs of the MP3 files to merge.
 * @param {string} randomFilename - Name of the merged MP3 file generated randomly.
 * @returns {Promise<void>} - Resolves when the file merge completes successfully.
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
) => {
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
};

export const SearchAnimeSentencesHealth = async (
  req: ControllerRequest<SearchAnimeSentencesRequest>,
  res: ControllerResponse<SearchAnimeSentencesResponse>,
) => {
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
};

export const GetContextAnime = async (
  req: ControllerRequest<GetContextAnimeRequest>,
  res: ControllerResponse<GetContextAnimeResponse>,
) => {
  const response = await querySurroundingSegments(req.body);

  res.status(StatusCodes.ACCEPTED).json(response);
};

export const GetWordsMatched = async (
  req: ControllerRequest<GetWordsMatchedRequest>,
  res: ControllerResponse<GetWordsMatchedResponse>,
) => {
  const { words, exact_match } = req.body;

  const response = await queryWordsMatched(words, exact_match);
  res.status(StatusCodes.OK).json(response);
};

export const getAllMedia = async (
  req: ControllerRequest<void, GetAllAnimesRequest>,
  res: ControllerResponse<GetAllAnimesResponse>,
) => {
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
};

export const updateSegment = async (req: Request, res: Response) => {
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

  // Respond to the client
  res.status(StatusCodes.OK).json({
    message: 'Segment updated successfully.',
  });
};
