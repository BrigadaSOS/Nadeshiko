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

const BUILD = '7cacf72b-0bb6-48ef-b756-7858e8a1aba7';

describe('archivableAssetName', () => {
  // Real Vite filenames include leading underscores for dynamic-route chunks.
  it.each([
    'DrC9mS-I2.js',
    'metaTags.BtUJQB1V.css',
    '_id_.CylgXoQM.css',
    '_...CfAQ-uCX.css',
    '0KcF1APn.js.map',
    'entry.B_5rQ3lk.woff2',
  ])('accepts %s, which is the shape a build actually emits', (name) => {
    expect(archivableAssetName(`/_nuxt/${BUILD}/${name}`)).toBe(`${BUILD}/${name}`);
  });

  it.each([
    ['no build segment at all', '/_nuxt/DrC9mS-I2.js'],
    ['a segment that is not a build id', '/_nuxt/assets/DrC9mS-I2.js'],
    ['a truncated build id', '/_nuxt/7cacf72b-0bb6/DrC9mS-I2.js'],
    ['an uppercase build id, which Nuxt does not emit', `/_nuxt/${BUILD.toUpperCase()}/DrC9mS-I2.js`],
    ['a third segment', `/_nuxt/${BUILD}/nested/DrC9mS-I2.js`],
  ])('declines %s', (_label, path) => {
    expect(archivableAssetName(path)).toBeNull();
  });

  it.each([
    ['a different prefix', '/assets/DrC9mS-I2.js'],
    ['the bare prefix', '/_nuxt/'],
    ['an HTML path that merely contains it', '/en/search/_nuxt/x.js'],
  ])('declines %s', (_label, path) => {
    expect(archivableAssetName(path)).toBeNull();
  });

  // Never archive the manifest whose job is to announce a new build.
  it.each([
    `/_nuxt/${BUILD}/builds/latest.json`,
    `/_nuxt/${BUILD}/builds/meta/e1559bf3.json`,
    '/_nuxt/builds/latest.json',
  ])('never serves %s', (path) => {
    expect(archivableAssetName(path)).toBeNull();
  });

  it.each([
    '/_nuxt/../../etc/passwd',
    '/_nuxt/..%2f..%2fetc%2fpasswd',
    '/_nuxt/%2e%2e%2fsecrets.env',
    '/_nuxt/.env',
    '/_nuxt/..',
    '/_nuxt/sub/dir.js',
    `/_nuxt/${BUILD}/../../etc/passwd`,
    `/_nuxt/${BUILD}/..%2f..%2fetc%2fpasswd`,
    `/_nuxt/${BUILD}/.env`,
    `/_nuxt/${BUILD}/..`,
    '/_nuxt/../7cacf72b-0bb6-48ef-b756-7858e8a1aba7/x.js',
  ])('refuses to resolve %s', (path) => {
    expect(archivableAssetName(path)).toBeNull();
  });
});

describe('archivedAssetPath', () => {
  it('resolves a validated name inside the archive', () => {
    expect(archivedAssetPath('/var/lib/assets', 'DrC9mS-I2.js')).toBe('/var/lib/assets/DrC9mS-I2.js');
  });

  // Recheck containment even for callers that bypass name validation.
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

  it('honours a shorter window', () => {
    const week = assetArchiveRetentionMs(7);
    const tenDaysAgo = now - assetArchiveRetentionMs(10);

    expect(assetHasExpired('old.js', tenDaysAgo, live, now, week)).toBe(true);
    expect(assetHasExpired('old.js', tenDaysAgo, live, now, RETENTION_MS)).toBe(false);
  });

  // Unchanged chunks may remain live longer than retention; age alone must not prune them.
  it('never expires a file the running build still uses, however old the copy is', () => {
    expect(assetHasExpired('live.js', 0, live, now, RETENTION_MS)).toBe(false);
  });
});

// Hidden sourcemaps are unreferenced by browser chunks and need no archive.
describe('isArchivableAsset', () => {
  it.each(['0KcF1APn.js.map', 'metaTags.BtUJQB1V.css.map'])('excludes the sourcemap %s', (name) => {
    expect(isArchivableAsset(name)).toBe(false);
  });

  it.each(['DrC9mS-I2.js', '_id_.CylgXoQM.css', 'entry.B_5rQ3lk.woff2'])('keeps %s', (name) => {
    expect(isArchivableAsset(name)).toBe(true);
  });

  it.each(['mapView.CylgXoQM.js', 'sitemap.Bq1x_-Ke.css'])('is not fooled by %s', (name) => {
    expect(isArchivableAsset(name)).toBe(true);
  });
});

describe('assetContentType', () => {
  it.each([
    ['DrC9mS-I2.js', 'text/javascript; charset=utf-8'],
    ['metaTags.BtUJQB1V.css', 'text/css; charset=utf-8'],
    // The final extension determines MIME type; a sourcemap is JSON, not JavaScript.
    ['0KcF1APn.js.map', 'application/json; charset=utf-8'],
    ['entry.B_5rQ3lk.woff2', 'font/woff2'],
  ])('types %s as %s', (name, expected) => {
    expect(assetContentType(name)).toBe(expected);
  });

  it.each(['mystery.bin', 'noextension'])('falls back to a download for %s', (name) => {
    expect(assetContentType(name)).toBe('application/octet-stream');
  });
});
