// Keep superseded assets available for open tabs and cached HTML. URLs must identify one byte sequence:
// post-hash JS mutations can break SRI, so separate builds by app.buildAssetsDir rather than reuse URLs.

import { resolve, sep } from 'node:path';

// Retention is based on mtime and configurable per environment. Startup touches live assets so unchanged chunks
// do not age out while the running build still references them.
export const ASSET_ARCHIVE_RETENTION_DAYS = 30;

export function assetArchiveRetentionMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

// Hidden sourcemaps are uploaded to PostHog, not referenced by browser chunks; archiving them wastes space.
export function isArchivableAsset(name: string): boolean {
  return !name.endsWith('.map');
}

const ASSET_PREFIX = '/_nuxt/';

// Strict filename allowlist prevents traversal, including encoded separators and leading dots. Leading underscores
// are allowed because Vite uses them for dynamic-route chunks.
const ASSET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

// Require a UUID build segment so Nuxt's builds/** manifests cannot address the archive.
const BUILD_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isBuildSegment(segment: string): boolean {
  return BUILD_SEGMENT.test(segment);
}

// Accept exactly <build>/<name>, never nested paths or app manifests: a stale latest.json would hide build changes.
// archivedAssetPath rechecks containment after resolving the validated key.
export function archivableAssetName(pathname: string): string | null {
  if (!pathname.startsWith(ASSET_PREFIX)) return null;

  const rest = pathname.slice(ASSET_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;

  const build = rest.slice(0, slash);
  const name = rest.slice(slash + 1);

  if (!BUILD_SEGMENT.test(build)) return null;
  if (!name || name.includes('/')) return null;
  if (!ASSET_NAME.test(name)) return null;

  return `${build}/${name}`;
}

// Recheck resolved containment before opening a file, even though the name allowlist already rejects traversal.
export function archivedAssetPath(dir: string, name: string): string | null {
  const root = resolve(dir);
  const file = resolve(root, name);

  return file.startsWith(root + sep) ? file : null;
}

// Live-build membership overrides age; unchanged chunks can be older than the retention window.
export function assetHasExpired(
  name: string,
  mtimeMs: number,
  liveAssets: ReadonlySet<string>,
  now: number,
  retentionMs: number,
): boolean {
  if (liveAssets.has(name)) return false;

  return now - mtimeMs >= retentionMs;
}

// Unknown extensions remain downloads rather than guessing their type.
const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

export function assetContentType(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();

  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

// Avoid parsing a URL on every request just to identify the asset prefix.
export function assetPathname(path: string): string {
  const query = path.indexOf('?');

  return query === -1 ? path : path.slice(0, query);
}
