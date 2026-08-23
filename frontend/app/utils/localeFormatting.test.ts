import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against formatting a number or a date without saying in which locale.
 *
 * `(1234).toLocaleString()` with no argument does not mean "the site's locale".
 * It means "whatever locale this JavaScript runtime defaults to" -- which is the
 * SERVER's on the way out and the READER'S BROWSER on the way back. For anything
 * server-rendered the two disagree the moment those differ: `RelatedWords.vue`
 * sent `23,931` from Node and re-rendered it as `23.931` in a German browser, so
 * Vue found two different strings over one text node and gave up on the tree
 * with "Hydration completed but contains mismatches." That was 138 reported
 * mismatches over 39 hours, about 2% of sessions, and it was invisible to every
 * en-US test run there has ever been -- including the ones that went looking for
 * it, since Playwright and CI both default to en-US exactly like the server.
 *
 * The rule is therefore: name the locale, or go through `useFormat()` /
 * `$n` / `$d`, which are bound to the page's own locale and so resolve the same
 * on both sides. `i18n.config.ts` pins timezones for the same reason.
 *
 * Written as a check rather than a convention because the broken call is the
 * shorter one, reads perfectly well, and fails only for readers the author is
 * statistically unlikely to be.
 */

const roots = ['app', 'server', 'shared'].map((dir) => fileURLToPath(new URL(`../../${dir}`, import.meta.url)));
const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Reading the reader's own timezone is the one honest use of the runtime
 * default: it is asking about the browser on purpose, from a `.client` plugin
 * that never runs during SSR, and the answer is telemetry rather than markup.
 */
const ALLOWED = new Set<string>([]);

/** `.toLocaleString()` and friends, called with no arguments at all. */
const BARE_TO_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(\s*\)/;

/** `new Intl.NumberFormat()` and friends, with no locale to format for. */
const BARE_INTL = /\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules)\(\s*\)/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|vue)$/.test(entry) && !entry.endsWith('.test.ts')) yield full;
  }
}

function findOffenders() {
  const offenders: string[] = [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(frontendRoot, file);
      if (ALLOWED.has(rel)) continue;

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          // Prose about the rule is not a breach of it.
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (BARE_TO_LOCALE.test(code) || BARE_INTL.test(code)) {
            offenders.push(`${rel}:${index + 1}  ${line.trim()}`);
          }
        });
    }
  }

  return offenders;
}

describe('locale-dependent formatting', () => {
  it('never formats against the runtime default locale', () => {
    expect(findOffenders()).toEqual([]);
  });

  it('recognises the shape it is guarding against', () => {
    // Belt and braces: a guard that silently stopped matching would pass
    // forever, and this one exists precisely because nobody notices the bug.
    expect(BARE_TO_LOCALE.test('count.toLocaleString()')).toBe(true);
    expect(BARE_TO_LOCALE.test('date.toLocaleDateString()')).toBe(true);
    expect(BARE_INTL.test('new Intl.NumberFormat()')).toBe(true);

    // Naming the locale is the fix, and must keep passing.
    expect(BARE_TO_LOCALE.test('count.toLocaleString(locale.value)')).toBe(false);
    expect(BARE_INTL.test('new Intl.NumberFormat(locale.value)')).toBe(false);
  });
});
