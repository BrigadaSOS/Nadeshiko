// Answer every build's /_nuxt/<build>/builds/latest.json with the running build's copy. Nuxt's outdated-build
// check polls that file under buildAssetsDir, and per-build asset directories make the URL self-referential:
// before a deploy it always reports the tab's own build, after one it 404s and the check swallows the error.
// Either way `app:manifest:update` never fires and open tabs keep the old client indefinitely.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assetPathname, isLatestManifestPath } from '~~/server/utils/assetArchive';
import { logger } from '~~/server/utils/logger';
import { prependRequestHandler } from '~~/server/utils/prependRequestHandler';

// Relative to the production working directory, like the asset archive's source.
const BUILD_ASSET_DIR = '.output/public/_nuxt';

export default defineNitroPlugin(async (nitroApp) => {
  // Dev serves no built manifest and never deploys over an open tab.
  if (import.meta.dev) return;

  const { buildId } = useRuntimeConfig().app;
  const file = join(resolve(process.cwd(), BUILD_ASSET_DIR), buildId, 'builds/latest.json');

  // Serve Nuxt's own bytes rather than rebuilding the object, so the id and timestamp match the live file exactly.
  let body: string;
  try {
    body = await readFile(file, 'utf8');
    const parsed = JSON.parse(body) as { id?: unknown };
    if (parsed.id !== buildId) throw new Error(`manifest id ${String(parsed.id)} does not match build ${buildId}`);
  } catch (error) {
    logger.error({ err: error, file }, 'latest build manifest: cannot read the running build manifest, staying off');
    return;
  }

  if (!prependRequestHandler(nitroApp, latestManifestHandler(body), 'latest build manifest')) return;

  logger.info({ buildId }, 'latest build manifest: answering every build with the running one');
});

function latestManifestHandler(body: string) {
  return defineEventHandler((event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return;

    const path = event.path;
    if (!path?.startsWith('/_nuxt/') || !isLatestManifestPath(assetPathname(path))) return;

    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
    // Nuxt cache-busts the poll with a timestamp query; no-cache also keeps any cache from answering a stale build.
    setResponseHeader(event, 'Cache-Control', 'no-cache');

    return event.method === 'HEAD' ? '' : body;
  });
}
