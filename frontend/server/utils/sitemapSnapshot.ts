import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { INDEXED_LOCALES } from '~/utils/i18n';

export function sitemapSnapshotFile(path: string): string | null {
  if (path === '/sitemap.xml' || path === '/sitemap_index.xml') return path.slice(1);
  for (const locale of INDEXED_LOCALES) {
    if (path === `/__sitemap__/${locale}.xml`) return `${locale}.xml`;
  }
  return null;
}

export async function publishedSitemap(dir: string, file: string) {
  const manifest = JSON.parse(await readFile(join(dir, 'current.json'), 'utf8'));
  const meta = manifest.files?.[file];
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(manifest.generation) ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !meta ||
    !/^[a-f0-9]{64}$/.test(meta.sha256) ||
    !Number.isSafeInteger(meta.bytes) ||
    meta.bytes < 1
  ) {
    throw new Error('Invalid sitemap snapshot manifest');
  }
  const path = join(dir, manifest.generation, file);
  if ((await stat(path)).size !== meta.bytes) throw new Error('Incomplete sitemap snapshot');
  return { path, bytes: meta.bytes as number, etag: `"${meta.sha256}"`, generatedAt: manifest.generatedAt as string };
}
