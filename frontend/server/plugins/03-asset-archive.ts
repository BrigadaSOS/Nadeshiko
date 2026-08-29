/**
 * Serves the previous builds' `/_nuxt/*` files, and keeps the archive they come
 * from current.
 *
 * See `server/utils/assetArchive.ts` for why the archive exists at all. This
 * file is both halves of using it: the request handler that answers from it, and
 * the startup pass that writes the running build into it.
 *
 * WHY THE HANDLER IS INSTALLED HERE AND NOT IN `server/middleware/`. Nitro's
 * public-asset handler is the FIRST layer of the request stack -- ahead of
 * everything in `server/middleware/`, which is the opposite of what the layout
 * suggests -- and on a miss under `/_nuxt/` it does not fall through:
 *
 *     if (!asset) {
 *       if (isPublicAssetURL(id)) {
 *         removeResponseHeader(event, "Cache-Control")
 *         throw createError({ statusCode: 404 })
 *       }
 *       return
 *     }
 *
 * So a middleware never sees these requests and a route never gets the chance
 * to. Nor can the archive be handed to that handler as a second public-asset
 * directory: it resolves through an object of assets inlined at BUILD time, and
 * a directory filled at runtime is invisible to it.
 *
 * What is left is to sit in front of it, which is what the stack surgery below
 * does. Plugins run after the stack is assembled (`runNitroPlugins` is called
 * once every `h3App.use()` has), so a layer moved to the front here is genuinely
 * first.
 */

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

/**
 * Where the running build's assets are, relative to the working directory.
 *
 * The image sets `WORKDIR /app` and starts `node .output/server/index.mjs`, so
 * this resolves to `/app/.output/public/_nuxt` in the container. Outside a built
 * server -- `nuxt dev`, a test run -- there is no `.output`, the listing below
 * fails, and the archive stays off. That is correct rather than unfortunate: dev
 * rebuilds chunks constantly and has no deploy to survive.
 */
const BUILD_ASSET_DIR = '.output/public/_nuxt';

export default defineNitroPlugin(async (nitroApp) => {
  const { assetArchiveDir, assetArchiveDays } = useRuntimeConfig();
  if (!assetArchiveDir) return;

  const retentionMs = assetArchiveRetentionMs(assetArchiveDays);

  const sourceDir = resolve(process.cwd(), BUILD_ASSET_DIR);

  // One level down now: `app.buildAssetsDir` gives each build its own segment,
  // so the running build's files live in `_nuxt/<buildId>/` and every key here
  // carries that segment. Directories that are not a build id -- there are none
  // today beyond the build's own `builds/` manifest folder, which sits INSIDE
  // the build segment -- are skipped rather than walked.
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

  // The directory is NOT created if it is missing. A missing mount would
  // otherwise be papered over with a container-local directory that works
  // perfectly until the container is replaced, which is exactly when this is
  // supposed to help -- better to refuse and say so.
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

  // Deliberately not awaited. Nothing in the request path needs it: a reader on
  // the current build is served by Nitro, and a reader on a previous one is
  // served by files a previous container already wrote. Every cluster worker
  // publishes: worker IDs are not reused after a replacement, while `publish`
  // is deliberately idempotent and tolerates sibling filesystem races.
  void publish(assetArchiveDir, sourceDir, liveAssets, retentionMs).catch((error: unknown) => {
    logger.error({ err: error }, 'asset archive: publishing the running build failed');
  });
});

/**
 * Puts the archive handler at the head of the request stack.
 *
 * `use()` does the normalising -- a layer is `{ route, match, handler }` and
 * building one by hand would be guessing at h3's shape -- and only the reorder
 * touches the array directly. Returns false rather than throwing if the stack is
 * not what this expects, because "appended" is not a lesser version of
 * "prepended" here: behind Nitro's static handler this never runs at all, and
 * the honest outcome is the archive staying off with a line in the log.
 */
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

  // Move exactly the layer `use()` just normalised. Do not use `pop()` here:
  // it would move an unrelated layer if a future `use()` wrapper appends more
  // than one layer. `stack` is H3's documented App surface, and preserving all
  // existing layer order is critical because Nitro's static handler otherwise
  // terminates missing `/_nuxt/` requests before this handler can see them.
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
    // Runs for EVERY request the server takes, so the cheapest possible test
    // that this is not one of ours comes first.
    if (event.method !== 'GET' && event.method !== 'HEAD') return;

    const path = event.path;
    if (!path?.startsWith('/_nuxt/')) return;

    const name = archivableAssetName(assetPathname(path));
    if (!name) return;

    // Never archived, so never answered from here -- and the live one has to
    // stay reachable, which means handing the request back to Nitro rather than
    // 404ing it as a miss.
    if (!isArchivableAsset(name)) return;

    // The running build has it: Nitro's own static handler answers, with the
    // etag, 304 and precompressed-variant handling this does not reimplement.
    if (liveAssets.has(name)) return;

    const file = archivedAssetPath(dir, name);
    const info = file ? await stat(file).catch(() => null) : null;

    if (!info?.isFile()) {
      // Answered here rather than left to Nitro, for the header alone. Nitro's
      // miss path removes `Cache-Control` entirely, and an asset 404 that says
      // nothing about caching is one Cloudflare applies the zone's one-hour
      // browser minimum to -- so a reader who lost a race with a deploy pins the
      // 404 in their own cache and keeps failing for an hour after the file is
      // back. `no-store` is the difference between a bad second and a bad hour.
      setResponseStatus(event, 404);
      setResponseHeader(event, 'Cache-Control', 'no-store');
      setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
      return 'Not found';
    }

    // Same headers the live build's assets get, and correct for the same reason:
    // the name is a content hash, so this response can never become wrong.
    setResponseHeader(event, 'Content-Type', assetContentType(name));
    setResponseHeader(event, 'Content-Length', info.size);
    setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    // The one externally visible sign that a reader is still on an older build.
    // `curl -I` on a chunk is how you confirm this path is live at all.
    setResponseHeader(event, 'X-Nd-Asset', 'archive');

    logger.debug({ name }, 'asset archive: served an asset from a superseded build');

    if (event.method === 'HEAD') return '';

    return sendStream(event, createReadStream(file));
  });
}

/**
 * Writes the running build into the archive and ages out what no longer belongs
 * to any recent one.
 *
 *   copy   every file of the running build that is not already there
 *   touch  every file of the running build, so a chunk that survives unchanged
 *          across months of deploys never ages out while still being live
 *   prune  anything older than the retention window the running build does not
 *          claim
 *
 * RUNS IN EVERY CLUSTER WORKER, not once per container: `NITRO_CLUSTER_WORKERS`
 * is 3 in production and each fork boots the full Nitro app. Every write here is
 * therefore idempotent and race-tolerant by construction rather than by locking
 * -- `COPYFILE_EXCL` makes the copy atomic-or-nothing, and touch and unlink
 * shrug off the file having been handled by a sibling a millisecond earlier.
 */
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
    // Sourcemaps are 85% of a build's bytes and nothing can request them. See
    // `isArchivableAsset`.
    if (!isArchivableAsset(name)) continue;

    const source = join(sourceDir, name);
    const destination = join(archiveDir, name);

    try {
      // `name` is `<build>/<file>`, so the build's directory has to exist before
      // the copy. Idempotent, and cheap enough to do per file rather than
      // tracking which builds have been created in this pass.
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      copied++;
      // A fresh copy already carries the current time, and skipping the extra
      // syscall here is the only reason this branch is separate from the touch.
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn({ err: error, name }, 'asset archive: could not archive an asset of the running build');
        continue;
      }
    }

    // Already present -- and NOT trusted on the strength of its name alone.
    //
    // The whole design rests on a content hash naming exactly one byte sequence,
    // and on 2026-08-13 that turned out to be violable: flipping
    // `sourcemap.client` between `true` and `'hidden'` changes every chunk's
    // bytes while changing no chunk's name, because Vite hashes before appending
    // the `sourceMappingURL` comment. Any build-level setting that rewrites
    // output after hashing can do the same.
    //
    // Left unchecked this archive would turn that from a transient problem into
    // a permanent one. The edge and the browser eventually expire or get purged;
    // an archived file is served by the ORIGIN for the whole retention window,
    // so the first version of a name would outlive the build that corrected it
    // and keep failing SRI against every later page that references it.
    //
    // So compare, and let the running build win. Cheap at this size: the archive
    // is ~1.9MB across ~83 files with the sourcemaps excluded.
    try {
      const [live, archived] = await Promise.all([readFile(source), readFile(destination)]);

      if (!live.equals(archived)) {
        // Not `COPYFILE_EXCL`: replacing it is the point. `copyFile` is
        // atomic enough here -- a concurrent worker writes identical bytes.
        await copyFile(source, destination);
        replaced++;
        logger.warn({ name }, 'asset archive: replaced an archived asset whose bytes no longer match the build');
        continue;
      }

      // Same bytes. Re-stamping is what keeps a long-lived chunk out of the
      // prune below.
      const stamp = new Date(now);
      await utimes(destination, stamp, stamp);
    } catch (error) {
      logger.warn({ err: error, name }, 'asset archive: could not verify an archived asset');
    }
  }

  const pruned = await prune(archiveDir, liveAssets, now, retentionMs);

  logger.info({ copied, replaced, pruned, retentionMs }, 'asset archive: publish complete');
}

/**
 * The shape this module used to write before `app.buildAssetsDir` gave each
 * build its own segment: a bare asset name in the archive root. Kept only so the
 * one-time cleanup above can recognise its own leftovers.
 */
const LEGACY_FLAT_ASSET = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

async function prune(
  archiveDir: string,
  liveAssets: ReadonlySet<string>,
  now: number,
  retentionMs: number,
): Promise<number> {
  let pruned = 0;

  // Walks build directories rather than files: the archive mirrors the layout
  // the server serves, so a name only means something with its build segment in
  // front of it. Anything in here that is not a build directory was not written
  // by this module and is left alone, same as a stray file always was.
  const builds = await readdir(archiveDir, { withFileTypes: true });

  for (const build of builds) {
    // Files sitting directly in the archive root are from before builds had
    // their own directory. Nothing can request them any more -- the served path
    // now requires a build segment -- so they are unreachable bytes on a volume
    // rather than a retention question, and they go on the first pass after the
    // upgrade. Guarded by the OLD allowlist so this can still only delete files
    // this module wrote: a stray file someone left here is left alone, exactly
    // as it always was.
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

      // Same allowlist that decides what may be SERVED from here, reused so this
      // pass can only ever delete files this module could have written. A stray
      // file someone left in the volume is left alone rather than tidied away.
      if (!archivableAssetName(`/_nuxt/${key}`)) {
        remaining++;
        continue;
      }

      const file = join(buildDir, entry.name);

      try {
        // A sourcemap in here can only be a leftover from before they were
        // excluded, and it will never be requested. Age is beside the point --
        // waiting out the retention window on 10MB of files nothing can ask for
        // is just a slower way of keeping them.
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
        // ENOENT is a sibling worker having pruned the same file first, which is
        // the expected outcome for two of the three workers.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({ err: error, name: key }, 'asset archive: could not prune an expired asset');
        }
        remaining++;
      }
    }

    // A build whose every file has aged out leaves an empty directory behind,
    // and they accumulate one per deploy forever. `rmdir` without `recursive`
    // is deliberate: it refuses a directory that still holds anything, so this
    // cannot race a sibling worker into deleting a build that is still live.
    if (remaining === 0) {
      try {
        await rmdir(buildDir);
      } catch {
        // ENOTEMPTY (a sibling wrote between the count and the call) or ENOENT
        // (a sibling removed it first). Both mean there is nothing to do.
      }
    }
  }

  return pruned;
}
