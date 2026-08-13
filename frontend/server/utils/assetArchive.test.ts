import { describe, expect, it } from 'vitest';
import {
  ASSET_ARCHIVE_RETENTION_DAYS,
  archivableAssetName,
  archivedAssetPath,
  assetArchiveRetentionMs,
  assetContentType,
  assetHasExpired,
  isArchivableAsset,
} from '~~/server/utils/assetArchive';

const RETENTION_MS = assetArchiveRetentionMs(ASSET_ARCHIVE_RETENTION_DAYS);

/**
 * `archivableAssetName` is the only thing between a request path and a file
 * read, so its rejections matter more than its acceptances.
 */
describe('archivableAssetName', () => {
  // Taken from a real `.output/public/_nuxt` listing rather than invented. The
  // two leading-underscore entries are Vite naming a chunk after the dynamic
  // route segment it belongs to, and they are why the allowlist cannot simply
  // require a leading letter.
  it.each([
    'DrC9mS-I2.js',
    'metaTags.BtUJQB1V.css',
    '_id_.CylgXoQM.css',
    '_...CfAQ-uCX.css',
    '0KcF1APn.js.map',
    'entry.B_5rQ3lk.woff2',
  ])('accepts %s, which is the shape a build actually emits', (name) => {
    expect(archivableAssetName(`/_nuxt/${name}`)).toBe(name);
  });

  it.each([
    ['a different prefix', '/assets/DrC9mS-I2.js'],
    ['the bare prefix', '/_nuxt/'],
    ['an HTML path that merely contains it', '/en/search/_nuxt/x.js'],
  ])('declines %s', (_label, path) => {
    expect(archivableAssetName(path)).toBeNull();
  });

  // The app manifest is Nuxt's own record of which build is current, served with
  // `maxAge: 1` so it is never stale. Serving a superseded copy of the file
  // whose entire job is to announce that the build changed would be worse than
  // the 404 this module exists to prevent.
  it.each(['/_nuxt/builds/latest.json', '/_nuxt/builds/meta/e1559bf3.json'])('never serves %s', (path) => {
    expect(archivableAssetName(path)).toBeNull();
  });

  // Nothing here can express a traversal: `/` is rejected outright, `%` is not
  // in the allowlist so no encoded separator survives to be decoded later, and a
  // leading dot is excluded, which rules out `.` and `..` by construction.
  it.each([
    '/_nuxt/../../etc/passwd',
    '/_nuxt/..%2f..%2fetc%2fpasswd',
    '/_nuxt/%2e%2e%2fsecrets.env',
    '/_nuxt/.env',
    '/_nuxt/..',
    '/_nuxt/sub/dir.js',
  ])('refuses to resolve %s', (path) => {
    expect(archivableAssetName(path)).toBeNull();
  });
});

describe('archivedAssetPath', () => {
  it('resolves a validated name inside the archive', () => {
    expect(archivedAssetPath('/var/lib/assets', 'DrC9mS-I2.js')).toBe('/var/lib/assets/DrC9mS-I2.js');
  });

  // Unreachable through `archivableAssetName`, and checked anyway: this is the
  // last line before an open(), and it costs one string compare.
  it.each(['../outside.js', '/etc/passwd', '..'])('returns null for %s', (name) => {
    expect(archivedAssetPath('/var/lib/assets', name)).toBeNull();
  });
});

describe('assetHasExpired', () => {
  const now = 1_800_000_000_000;
  const live = new Set(['live.js']);

  it('expires a file the running build does not claim once the window has passed', () => {
    expect(assetHasExpired('old.js', now - RETENTION_MS, live, now, RETENTION_MS)).toBe(true);
  });

  it('keeps a superseded file that is still inside the window', () => {
    expect(assetHasExpired('old.js', now - RETENTION_MS + 1, live, now, RETENTION_MS)).toBe(false);
  });

  // Staging runs a seven-day window against production's thirty, so the same
  // file has to be expired by one and kept by the other.
  it('honours a shorter window', () => {
    const week = assetArchiveRetentionMs(7);
    const tenDaysAgo = now - assetArchiveRetentionMs(10);

    expect(assetHasExpired('old.js', tenDaysAgo, live, now, week)).toBe(true);
    expect(assetHasExpired('old.js', tenDaysAgo, live, now, RETENTION_MS)).toBe(false);
  });

  /**
   * The case that makes this a function rather than a date comparison. An
   * unchanged chunk keeps its content hash across builds, so after enough
   * deploys its archived copy is arbitrarily old while still being served by the
   * running build -- pruning on age alone would delete a live asset.
   *
   * The startup pass restamps these, so in practice the age never gets here;
   * this is the assertion that says the restamp is a belt and not the braces.
   */
  it('never expires a file the running build still uses, however old the copy is', () => {
    expect(assetHasExpired('live.js', 0, live, now, RETENTION_MS)).toBe(false);
  });
});

/**
 * Sourcemaps are 10.6MB of a 12.5MB build and NOTHING can request them:
 * `sourcemap: { client: 'hidden' }` emits them without a `sourceMappingURL`, so
 * no chunk points at one. Keeping them would size the volume seven times larger
 * to protect requests that cannot happen.
 */
describe('isArchivableAsset', () => {
  it.each(['0KcF1APn.js.map', 'metaTags.BtUJQB1V.css.map'])('excludes the sourcemap %s', (name) => {
    expect(isArchivableAsset(name)).toBe(false);
  });

  it.each(['DrC9mS-I2.js', '_id_.CylgXoQM.css', 'entry.B_5rQ3lk.woff2'])('keeps %s', (name) => {
    expect(isArchivableAsset(name)).toBe(true);
  });

  // `.map` is matched at the END of the name, not anywhere in it: a chunk built
  // from a `map`-named module is a chunk, and dropping it would 404 a live page.
  it.each(['mapView.CylgXoQM.js', 'sitemap.Bq1x_-Ke.css'])('is not fooled by %s', (name) => {
    expect(isArchivableAsset(name)).toBe(true);
  });
});

describe('assetContentType', () => {
  it.each([
    ['DrC9mS-I2.js', 'text/javascript; charset=utf-8'],
    ['metaTags.BtUJQB1V.css', 'text/css; charset=utf-8'],
    // Two extensions, and the last one decides -- a sourcemap is JSON, not a
    // script, and serving it as one is how a devtools fetch gets refused.
    ['0KcF1APn.js.map', 'application/json; charset=utf-8'],
    ['entry.B_5rQ3lk.woff2', 'font/woff2'],
  ])('types %s as %s', (name, expected) => {
    expect(assetContentType(name)).toBe(expected);
  });

  it.each(['mystery.bin', 'noextension'])('falls back to a download for %s', (name) => {
    expect(assetContentType(name)).toBe('application/octet-stream');
  });
});
