import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against the brand appearing twice in a `<title>`.
 *
 * `@nuxtjs/seo` installs `titleTemplate: '%s %separator %siteName'`, so EVERY
 * page title is rendered as `<what the page set> | Nadeshiko`. Anything that
 * sets a title already containing the brand therefore ships it twice --
 * `Changelog | Nadeshiko | Nadeshiko` was live in the changelog's front matter,
 * and `appMeta.defaultTitle` did the same on the seventeen account and admin
 * screens that set no title of their own.
 *
 * The rule is easy to break by writing a perfectly reasonable-looking string, so
 * it is checked rather than remembered.
 */

const BRAND = 'Nadeshiko';
const localesDir = fileURLToPath(new URL('../../i18n/locales', import.meta.url));
const contentDir = fileURLToPath(new URL('../../content', import.meta.url));

/**
 * Strings that carry the brand on purpose.
 *
 * `seo.home.title` is the home page, and `pages/index.vue` overrides the
 * template with `'%s'` precisely so the brand leads there. `appMeta.defaultTitle`
 * is only ever used for `og:title`/`twitter:title`, which are set explicitly and
 * never run through the template.
 */
const ALLOWED_BRANDED = new Set(['seo.home.title', 'appMeta.defaultTitle']);

/**
 * Keys whose value ends up inside a `<title>`.
 *
 * Scoped to the `seo.*` namespace and the app-wide default rather than anything
 * ending in `.title`: plenty of headings are legitimately about the product
 * ("Do you like Nadeshiko?", "Nadeshiko in Numbers") and those render into the
 * page body, where the template never reaches them.
 */
const isTitleKey = (path: string) =>
  /^seo\.[^.]+\.(title|pageTitle|wordTitle)$/.test(path) || path === 'appMeta.defaultPageTitle';

function* flatten(value: unknown, path = ''): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [path, value];
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      yield* flatten(child, path ? `${path}.${key}` : key);
    }
  }
}

const locales = readdirSync(localesDir).filter((name) => name.endsWith('.json'));

describe('title strings do not carry the brand', () => {
  it.each(locales)('%s', (file) => {
    const messages = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));

    const offenders = [...flatten(messages)]
      .filter(([path]) => isTitleKey(path) && !ALLOWED_BRANDED.has(path))
      .filter(([, value]) => value.includes(BRAND))
      .map(([path, value]) => `${path} = ${value}`);

    expect(offenders).toEqual([]);
  });
});

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* markdownFiles(full);
    else if (entry.endsWith('.md')) yield full;
  }
}

describe('content front matter does not repeat the brand', () => {
  /**
   * Anywhere in the title, not just as a suffix.
   *
   * The template appends the brand to every one of these, so a title containing
   * it renders it twice however it got there -- `Changelog | Nadeshiko` bolted it
   * on, `About Nadeshiko` named the product, and `Nadeshiko v2.1.0` led with it.
   * All three read as a stutter in a search result, and the versioned posts were
   * also the longest titles on the site. The convention is simply that front
   * matter names the page and the template supplies the brand.
   */
  it('no page title contains the brand', () => {
    const offenders: string[] = [];

    for (const file of markdownFiles(contentDir)) {
      const title = /^title:\s*"?(.+?)"?\s*$/m.exec(readFileSync(file, 'utf8').split('---')[1] ?? '')?.[1];
      if (title?.includes(BRAND)) {
        offenders.push(`${file.replace(contentDir, 'content')}: ${title} | ${BRAND}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
