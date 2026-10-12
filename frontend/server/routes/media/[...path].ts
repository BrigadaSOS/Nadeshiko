import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { sendStream, setResponseHeader, createError } from 'h3';
import { MediaPathForbiddenError, resolveMediaFilePath } from '~~/server/utils/mediaPath';

const MIME_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path');
  if (!path) {
    throw createError({ statusCode: 400, statusMessage: 'Missing path' });
  }

  const config = useRuntimeConfig();

  const mediaBasePath = resolve(config.mediaFilesPath || '../media');
  let filePath: string;
  try {
    filePath = await resolveMediaFilePath(mediaBasePath, path);
  } catch (error: unknown) {
    if (error instanceof MediaPathForbiddenError) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    // Map guessed/nonexistent file paths to 404 without exposing filesystem errors.
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  setResponseHeader(event, 'Content-Type', contentType);
  setResponseHeader(event, 'Content-Length', fileStat.size);
  setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');

  return sendStream(event, createReadStream(filePath));
});
