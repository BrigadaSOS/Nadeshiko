import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `@nuxtjs/robots` does not treat the `robots:` block in nuxt.config as the only
// source of truth: at build time it scans these paths for a hand-written
// robots.txt and *appends* whatever groups it finds to the configured ones
// (node_modules/@nuxtjs/robots/dist/module.mjs, `mergeWithRobotsTxtPath`).
// The list is verbatim from that module, relative to the Nuxt root (frontend/).
const MERGE_PATHS = [
  'public/robots.txt',
  'assets/robots.txt',
  'public/_robots.txt',
  'public/_dir/robots.txt',
  'pages/_dir/robots.txt',
  'pages/robots.txt',
  'robots.txt',
];

const frontendRoot = fileURLToPath(new URL('../../', import.meta.url));

// A wildcard `Disallow: /` in any merged file does more than add a group: the
// runtime derives `indexable` from the merged disallow list, so it flips the
// whole site to "indexing disabled" -- robots.txt becomes `Disallow: /` and
// every route grows an `X-Robots-Tag: noindex, nofollow`, whatever nuxt.config
// says.
//
// This is not hypothetical. `frontend/robots.txt` was committed by accident in
// April 2026 alongside a blog post's screenshots and deindexed production for
// three months. The module's only complaint is a build-time `logger.warn` that
// scrolls past in CI. Staging is meant to be noindex, but it gets there through
// the `isDev` branch in nuxt.config -- never through a file, which cannot tell
// the two environments apart.
function blocksEveryCrawler(contents: string): boolean {
  let inWildcardGroup = false;
  for (const raw of contents.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') inWildcardGroup = value === '*';
    else if (key === 'disallow' && inWildcardGroup && value === '/') return true;
  }
  return false;
}

describe('robots.txt files merged by @nuxtjs/robots', () => {
  it('does not block indexing from a file, in any of the paths the module scans', () => {
    const offenders = MERGE_PATHS.filter((path) => {
      const absolute = new URL(path, `file://${frontendRoot}`);
      return existsSync(absolute) && blocksEveryCrawler(readFileSync(absolute, 'utf8'));
    });

    expect(offenders, `use the \`isDev\` branch of \`robots:\` in nuxt.config instead`).toEqual([]);
  });
});

describe('blocksEveryCrawler', () => {
  it('recognises the shape that deindexed production', () => {
    expect(blocksEveryCrawler('User-agent: *\nDisallow: /\n')).toBe(true);
  });

  it('ignores a disallow-all scoped to one named crawler', () => {
    expect(blocksEveryCrawler('User-agent: GPTBot\nDisallow: /\n')).toBe(false);
  });

  it('ignores disallowed subtrees, which are the normal case', () => {
    expect(blocksEveryCrawler('User-agent: *\nDisallow: /en/admin\nAllow: /en/\n')).toBe(false);
  });

  it('reads past comments and blank lines', () => {
    expect(blocksEveryCrawler('# staging\n\nUser-agent: *\n\nDisallow: / # everything\n')).toBe(true);
  });
});
