import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCORD_GUILD_ID, DISCORD_INVITE_CODE } from './socialLinks';

/**
 * The Discord invite is written out literally in places `socialLinks.ts` cannot
 * reach: markdown content in three locales, CONTRIBUTING.md, the bot (a separate
 * build), and the Gatus check (a separate repo). This test is what makes those
 * copies safe -- it walks the repo, finds every `discord.gg/<code>` in it, and
 * fails on any that disagrees with the constant.
 *
 * It exists because the invite died once and the find-and-replace that was meant
 * to fix it produced `c6yGwbXruq` + the old code concatenated, in all fifteen
 * places at once, with nothing to catch it. A dead invite is silent by nature:
 * `discord.gg` answers 200 for revoked codes and says "invite invalid" only in
 * client-side JS, so no link checker reports it and no user tells you.
 *
 * What this does NOT check is whether the invite still resolves -- that is a
 * live network fact, not a repo fact, and it belongs in Gatus. This test only
 * guarantees the repo speaks with one voice about which code is the right one.
 *
 * When it fails: copy DISCORD_INVITE_CODE into the files it names.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'playwright-report', 'test-results']);

/**
 * Dot-directories are tooling scratch -- `.jj`, `.nuxt`, `.output`, and in
 * particular `.playwright-mcp`, whose page dumps are snapshots of whatever the
 * site served on the day they were taken. Those legitimately contain the *old*
 * invite and always will; holding a recording of the past to the present code
 * would make this test fail forever. `.github` is ours and gets scanned.
 */
const isScratchDir = (name: string) => name.startsWith('.') && name !== '.github';

/** Text we author or ship. Anything else cannot contain a link a reader clicks. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.vue', '.md', '.mdc', '.html', '.json', '.yml', '.yaml'];

/**
 * Test fixtures use invented codes (`discord.gg/x`) to exercise link parsing.
 * They are not links anybody follows, so holding them to the real code would
 * only make the fixtures lie about what they are testing.
 */
const isFixture = (path: string) => path.endsWith('.test.ts');

const INVITE = /discord\.gg\/([A-Za-z0-9-]+)/g;

type Occurrence = { where: string; code: string };

function scan(dir: string, found: Occurrence[] = []): Occurrence[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !isScratchDir(entry.name)) scan(path, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (isFixture(path)) continue;

    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(INVITE)) {
          found.push({ where: `${relative(REPO_ROOT, path)}:${index + 1}`, code: match[1] as string });
        }
      });
  }
  return found;
}

describe('Discord invite copies', () => {
  const occurrences = scan(REPO_ROOT);

  // A walker that resolved the wrong root would find nothing and pass silently,
  // which is the one failure this test cannot afford.
  it('finds the invite where it is written out', () => {
    expect(occurrences.length).toBeGreaterThan(10);
  });

  it('all agree with DISCORD_INVITE_CODE', () => {
    const wrong = occurrences.filter((o) => o.code !== DISCORD_INVITE_CODE);
    expect(wrong.map((o) => `${o.where} -> ${o.code}`)).toEqual([]);
  });
});

/**
 * The Gatus endpoint that actually notices a dead invite lives in the infra
 * repo, checked out next to this one. It carries its own copy of the code, and
 * a stale one there means the monitor cheerfully watches a link nobody uses.
 *
 * Skipped rather than failed when the sibling is absent: CI clones this repo
 * alone, and this is a local safety net, not a gate.
 */
const GATUS_CONFIG = fileURLToPath(
  new URL('../../../../brigadasos-infra/machines/monitoring/gatus/config/config.yaml', import.meta.url),
);

describe.skipIf(!existsSync(GATUS_CONFIG))('Gatus invite check', () => {
  const config = () => readFileSync(GATUS_CONFIG, 'utf8');

  it('watches the current invite code', () => {
    expect(config()).toContain(`https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}`);
  });

  it('asserts the invite resolves to our guild', () => {
    expect(config()).toContain(DISCORD_GUILD_ID);
  });
});
