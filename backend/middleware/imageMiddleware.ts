import express from 'express';
import path from 'path';
import sharp from 'sharp';
import { existsSync, mkdirSync, safePath, statSync } from '../utils/fs';

/**
 * Create middleware for serving and caching resized images.
 *
 * - If no dimensions requested, serves original image via express.static
 * - If cached version exists, serves it (with cache headers)
 * - Otherwise, generates resized image, caches it, and serves it
 */
export const createImageMiddleware = (
  baseMediaDir: string,
  cacheDirSuffix: string,
  useHighQualityKernel: boolean = false,
) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    const dimensions = extractDimensions(req);
    const imagePath = safePath(baseMediaDir, req.path);

    // No resizing requested - serve original
    if (!dimensions.width && !dimensions.height) {
      return express.static(baseMediaDir, {
        maxAge: '30d',
        etag: true,
        lastModified: true,
        fallthrough: false,
      })(req, res, next);
    }

    const { cacheDir, cachePath } = getCachePath(baseMediaDir, cacheDirSuffix, req.path, dimensions);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Serve cached version if available
    if (existsSync(cachePath)) {
      if (setCacheHeaders(res, req, cachePath)) return;
      return res.sendFile(cachePath);
    }

    // Generate and serve resized image
    await generateResizedImage(imagePath, cachePath, dimensions, useHighQualityKernel);
    if (setCacheHeaders(res, req, cachePath)) return;
    res.sendFile(cachePath);
  };
};

type Dimensions = {
  width: number | null;
  height: number | null;
};

function extractDimensions(req: express.Request): Dimensions {
  const width = req.query.width ? Number(req.query.width) : null;
  const height = req.query.height ? Number(req.query.height) : null;
  return { width, height };
}

function getCachePath(
  baseMediaDir: string,
  cacheDirSuffix: string,
  requestPath: string,
  dimensions: Dimensions,
): { cacheDir: string; cachePath: string } {
  const cacheDir = safePath(baseMediaDir, cacheDirSuffix, path.dirname(requestPath));
  const basename = path.basename(requestPath.replace('.webp', ''));
  const sizeSuffix = `${dimensions.width}_${dimensions.height}`;
  const cachePath = safePath(cacheDir, `${basename}-${sizeSuffix}.webp`);
  return { cacheDir, cachePath };
}

function setCacheHeaders(res: express.Response, req: express.Request, filePath: string): boolean {
  const stats = statSync(filePath, `Image not found: ${path.basename(filePath)}`);

  const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

  res.setHeader('Cache-Control', 'public, max-age=2592000, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stats.mtime.toUTCString());

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

async function generateResizedImage(
  imagePath: string,
  cachePath: string,
  dimensions: Dimensions,
  useHighQualityKernel: boolean,
): Promise<void> {
  const resizeOptions = useHighQualityKernel ? { kernel: sharp.kernel.lanczos3 } : {};

  await sharp(imagePath).resize(dimensions.width, dimensions.height, resizeOptions).toFile(cachePath);
}
