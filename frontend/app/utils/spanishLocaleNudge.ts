/**
 * Whether to tell an English-page reader that Spanish exists.
 *
 * WHY THIS IS A NUDGE AND NOT A REDIRECT. `server/utils/localeRouting.ts` gives
 * the reasoning in full: the root locale decision reads one plain cookie and
 * nothing else, so Cloudflare can answer it at the edge instead of Helsinki, and
 * Google asks that a site offer a language switcher rather than redirect on its
 * own. The trade written down there is that "a Spanish speaker's first visit
 * starts in English and costs them one click on the language selector". This is
 * that click, offered rather than waited for. It must never become a redirect,
 * and it must never move the decision to the server -- see below.
 *
 * WHY IT IS CLIENT-SIDE, which is the constraint that shapes everything here.
 * Anonymous HTML is cached at the edge (`X-Nd-Cache-Tier: shared`), so a banner
 * decided during SSR would be baked into the cached copy and served to everyone
 * or to no one, depending on who warmed it. That is the same cache-poisoning
 * shape as `nd-motion`, and the fix is not to fork the render but to keep the
 * decision in the browser where it costs the cache nothing.
 *
 * LANGUAGE, NOT COUNTRY, and that is a deliberate narrowing of the request. The
 * ask was "a user from a Spanish-speaking country", but the country is only
 * knowable from `CF-IPCountry`, which is a server header -- reading it would
 * either fork the cached HTML or cost an extra request per page load. The
 * browser's own language list is free, needs no request, and answers the better
 * question anyway: a Spanish speaker in Berlin wants this, and an English
 * speaker in Madrid does not.
 */

/** Where the "no thanks" lives. `localStorage`, not a cookie: a cookie would be sent on every request and this is only ever read in the browser. */
export const SPANISH_NUDGE_DISMISSED_KEY = 'nd-es-nudge-dismissed';

/**
 * Matches on the primary subtag only, so `es`, `es-ES`, `es-419` and `es-MX` all
 * count and `est` (Estonian) does not -- `startsWith('es')` would have taken it.
 */
export function speaksSpanish(languages: readonly string[] | undefined | null): boolean {
  if (!languages) return false;
  return languages.some((tag) => typeof tag === 'string' && tag.trim().toLowerCase().split('-')[0] === 'es');
}

/**
 * Every read and write is wrapped: a private window, cleared site data, or a
 * browser set to block storage all throw on access rather than returning null,
 * and a reader whose browser refuses storage should still get the page.
 */
export function isSpanishNudgeDismissed(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(SPANISH_NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSpanishNudge(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(SPANISH_NUDGE_DISMISSED_KEY, '1');
  } catch {
    // A reader who cannot store the dismissal sees it again next visit. That is
    // worse than remembering and better than an unhandled throw on page load.
  }
}

export interface SpanishNudgeInput {
  /** The page's current locale, from `useI18n()`. */
  locale: string;
  /** `navigator.languages`. */
  languages: readonly string[] | undefined | null;
  dismissed: boolean;
}

/** Offered once, to a Spanish speaker, reading an English page, who has not already said no. */
export function shouldOfferSpanish({ locale, languages, dismissed }: SpanishNudgeInput): boolean {
  if (dismissed) return false;
  // Only from English. On `/es` it is redundant, and on `/ja` a reader who chose
  // Japanese is not asking to be sent somewhere else.
  if (locale !== 'en') return false;
  return speaksSpanish(languages);
}
