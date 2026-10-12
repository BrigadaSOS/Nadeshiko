// Install before Nitro's public-asset handler, which terminates /_nuxt misses before middleware/routes run.
// Its asset table is built at compile time, so runtime archives cannot become a second static directory.

import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rmdir, stat, utimes, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  archivableAssetName,
  archivedAssetPath,
  assetArchiveRetentionMs,
  assetContentType,
  assetHasExpired,
  assetPathname,
  isArchivableAsset,
  isBuildSegment,
} from '~~/server/utils/assetArchive';
import { logger } from '~~/server/utils/logger';

// Relative to the production working directory; without a built .output tree the archive stays disabled.
const BUILD_ASSET_DIR = '.output/public/_nuxt';

export default defineNitroPlugin(async (nitroApp) => {
  const { assetArchiveDir, assetArchiveDays } = useRuntimeConfig();
  if (!assetArchiveDir) return;

  const retentionMs = assetArchiveRetentionMs(assetArchiveDays);

  const sourceDir = resolve(process.cwd(), BUILD_ASSET_DIR);

  // Read only UUID build directories; manifests and unrelated directories are not archive assets.
  let liveAssets: Set<string>;
  try {
    const builds = await readdir(sourceDir, { withFileTypes: true });
    liveAssets = new Set<string>();

    for (const build of builds) {
      if (!build.isDirectory() || !isBuildSegment(build.name)) continue;

      const files = await readdir(join(sourceDir, build.name), { withFileTypes: true });
      for (const file of files) {
        if (file.isFile()) liveAssets.add(`${build.name}/${file.name}`);
      }
    }
  } catch (error) {
    logger.error({ err: error, sourceDir }, 'asset archive: cannot list the running build, staying off');
    return;
  }

  // Require the mounted archive directory. Creating a local replacement would hide a mount failure until redeploy.
  try {
    const info = await stat(assetArchiveDir);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch (error) {
    logger.error({ err: error, assetArchiveDir }, 'asset archive: directory unavailable, staying off');
    return;
  }

  if (!install(nitroApp, assetArchiveDir, liveAssets)) return;

  logger.info(
    { assetArchiveDir, liveAssets: liveAssets.size, retentionDays: assetArchiveDays },
    'asset archive: serving superseded builds',
  );

  // Publish asynchronously in every worker; current files use Nitro and old builds are already archived.
  // Publishing is idempotent and tolerates sibling filesystem races.
  void publish(assetArchiveDir, sourceDir, liveAssets, retentionMs).catch((error: unknown) => {
    logger.error({ err: error }, 'asset archive: publishing the running build failed');
  });
});

// Let h3App.use normalize the layer, then prepend it. Unexpected stack shapes disable the archive rather
// than leave an unreachable handler behind Nitro static serving.
function install(
  nitroApp: { h3App?: { use?: unknown; stack?: unknown } },
  dir: string,
  liveAssets: ReadonlySet<string>,
): boolean {
  const h3App = nitroApp.h3App;

  if (!h3App || typeof h3App.use !== 'function' || !Array.isArray(h3App.stack)) {
    logger.error('asset archive: cannot reach the request stack, staying off');
    return false;
  }

  const stack = h3App.stack as unknown[];
  const before = stack.length;

  (h3App.use as (handler: unknown) => unknown)(archiveHandler(dir, liveAssets));

  if (stack.length !== before + 1) {
    logger.error('asset archive: the request stack did not take the handler, staying off');
    return false;
  }

  // Move exactly the newly registered layer, preserving all other order; pop could select an unrelated future layer.
  const [layer] = stack.splice(before, 1);
  if (!layer) {
    logger.error('asset archive: could not identify its request handler, staying off');
    return false;
  }
  stack.unshift(layer);

  return true;
}

function archiveHandler(dir: string, liveAssets: ReadonlySet<string>) {
  return defineEventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return;

    const path = event.path;
    if (!path?.startsWith('/_nuxt/')) return;

    const name = archivableAssetName(assetPathname(path));
    if (!name) return;

    // Unarchived assets must fall through so Nitro can still serve the live file.
    if (!isArchivableAsset(name)) return;

    // Let Nitro serve live assets with its ETag, 304 and precompression support.
    if (liveAssets.has(name)) return;

    const file = archivedAssetPath(dir, name);
    const info = file ? await stat(file).catch(() => null) : null;

    if (!info?.isFile()) {
      // Return no-store on archive misses: Nitro removes Cache-Control, allowing the edge's browser minimum to pin a 404.
      setResponseStatus(event, 404);
      setResponseHeader(event, 'Cache-Control', 'no-store');
      setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
      return 'Not found';
    }

    setResponseHeader(event, 'Content-Type', assetContentType(name));
    setResponseHeader(event, 'Content-Length', info.size);
    setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');

    setResponseHeader(event, 'X-Nd-Asset', 'archive');

    logger.debug({ name }, 'asset archive: served an asset from a superseded build');

    if (event.method === 'HEAD') return '';

    return sendStream(event, createReadStream(file));
  });
}

// Publish/touch live files and prune expired ones. Every worker may run this pass; writes must tolerate races.
async function publish(
  archiveDir: string,
  sourceDir: string,
  liveAssets: ReadonlySet<string>,
  retentionMs: number,
): Promise<void> {
  const now = Date.now();
  let copied = 0;
  let replaced = 0;

  for (const name of liveAssets) {
    if (!isArchivableAsset(name)) continue;

    const source = join(sourceDir, name);
    const destination = join(archiveDir, name);

    try {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      copied++;
      // A fresh copy already has a current mtime; skip the extra touch syscall.
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn({ err: error, name }, 'asset archive: could not archive an asset of the running build');
        continue;
      }
    }

    // Post-hash build mutations can change bytes without changing filenames. Compare existing copies and let
    // the running build win rather than preserve an SRI-breaking archive for the retention window.
    try {
      const [live, archived] = await Promise.all([readFile(source), readFile(destination)]);

      if (!live.equals(archived)) {
        // Replace mismatched bytes; concurrent workers copy the same running build.
        await copyFile(source, destination);
        replaced++;
        logger.warn({ name }, 'asset archive: replaced an archived asset whose bytes no longer match the build');
        continue;
      }

      // Refresh mtime so unchanged live chunks survive pruning.
      const stamp = new Date(now);
      await utimes(destination, stamp, stamp);
    } catch (error) {
      logger.warn({ err: error, name }, 'asset archive: could not verify an archived asset');
    }
  }

  const pruned = await prune(archiveDir, liveAssets, now, retentionMs);

  logger.info({ copied, replaced, pruned, retentionMs }, 'asset archive: publish complete');
}

// Recognize only pre-build-directory assets during legacy cleanup.
const LEGACY_FLAT_ASSET = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

async function prune(
  archiveDir: string,
  liveAssets: ReadonlySet<string>,
  now: number,
  retentionMs: number,
): Promise<number> {
  let pruned = 0;

  // Only recognized build directories belong to this archive; leave unrelated entries alone.
  const builds = await readdir(archiveDir, { withFileTypes: true });

  for (const build of builds) {
    // Legacy flat assets are unreachable now. Delete only names allowed by the old archive format.
    if (build.isFile()) {
      if (!LEGACY_FLAT_ASSET.test(build.name)) continue;

      try {
        await unlink(join(archiveDir, build.name));
        pruned++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({ err: error, name: build.name }, 'asset archive: could not prune a pre-build-segment asset');
        }
      }
      continue;
    }

    if (!build.isDirectory() || !isBuildSegment(build.name)) continue;

    const buildDir = join(archiveDir, build.name);
    const entries = await readdir(buildDir, { withFileTypes: true });
    let remaining = 0;

    for (const entry of entries) {
      if (!entry.isFile()) {
        remaining++;
        continue;
      }

      const key = `${build.name}/${entry.name}`;

      // Reuse the serving allowlist so pruning cannot delete unrelated volume files.
      if (!archivableAssetName(`/_nuxt/${key}`)) {
        remaining++;
        continue;
      }

      const file = join(buildDir, entry.name);

      try {
        // Old sourcemaps are unreachable and can be removed without waiting for retention.
        if (!isArchivableAsset(entry.name)) {
          await unlink(file);
          pruned++;
          continue;
        }

        const info = await stat(file);
        if (!assetHasExpired(key, info.mtimeMs, liveAssets, now, retentionMs)) {
          remaining++;
          continue;
        }

        await unlink(file);
        pruned++;
      } catch (error) {
        // A sibling may already have pruned this file.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({ err: error, name: key }, 'asset archive: could not prune an expired asset');
        }
        remaining++;
      }
    }

    // Use nonrecursive rmdir so a sibling publishing into this directory cannot lose live files.
    if (remaining === 0) {
      try {
        await rmdir(buildDir);
      } catch {
        // A sibling wrote into or removed the directory; both races need no action.
      }
    }
  }

  return pruned;
}
