/**
 * Pure merging and filtering for device-local recents and account SEARCH activity. `useSearchRecents` owns
 * storage and fetching.
 */

/** The title a search was scoped to, when it was run inside one. */
export type RecentSearchMedia = {
  publicId: string;
  /** For the row's label. Absent when the search that recorded it named nothing. */
  name?: string;
};

export type RecentSearch = {
  /** The query as the reader last ran it. */
  query: string;
  /** ISO-8601, UTC, the last time this query was run. */
  searchedAt: string;
  /**
   * The `UserActivity` row ids this entry stands for, so forgetting one row in
   * the menu deletes every server row that produced it. Empty for an entry this
   * device recorded and the account has not answered for yet.
   */
  ids: number[];
  /** Absent for a search run across everything, which is most of them. */
  media?: RecentSearchMedia;
};

/** How many entries the device list keeps. */
export const RECENTS_LIMIT = 50;

/** How many rows the menu under the bar shows at once. */
export const RECENTS_MENU_SIZE = 8;

/**
 * Fetch more raw activity rows than the deduplicated limit because repeated searches otherwise consume the
 * window.
 */
export const RECENTS_FETCH_SIZE = 100;

/** The ARIA contract between the input and the menu, shared so it cannot drift. */
export const RECENTS_LISTBOX_ID = 'search-recents-listbox';
export const recentOptionId = (index: number) => `search-recent-${index}`;

/** Trims and collapses whitespace; the display form of a stored query. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * The query alone, case-folded: what narrowing matches on. Folded so `ohayou`
 * and `Ohayou` are one row rather than two -- Japanese is unaffected, and the
 * reader who typed romaji twice with a stray capital did not mean to file two
 * searches.
 */
export function queryKey(query: string): string {
  return normalizeQuery(query).toLocaleLowerCase();
}

/**
 * Identity is normalized query plus title scope, not episode or tab. NUL separation avoids collisions with
 * query punctuation.
 */
export function recentKey(entry: Pick<RecentSearch, 'query' | 'media'>): string {
  return `${queryKey(entry.query)}\u0000${entry.media?.publicId ?? ''}`;
}

/**
 * Normalizes a timestamp to UTC ISO, and refuses one from the future.
 *
 * A clock-skewed device that stamps tomorrow onto an entry would otherwise pin
 * it to the top of the list for good, since the ordering is the timestamp.
 * Unparseable stamps -- a hand-edited `localStorage`, an older shape -- are
 * treated the same way, as "now", rather than dropping the entry.
 */
export function clampTimestamp(value: string | undefined, now: Date = new Date()): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed) || parsed > now.getTime()) return now.toISOString();
  return new Date(parsed).toISOString();
}

function mergeIds(left: number[], right: number[]): number[] {
  if (right.length === 0) return left;
  const seen = new Set(left);
  return [...left, ...right.filter((id) => !seen.has(id))];
}

/**
 * Merge by query and title scope, newest first, capped at `RECENTS_LIMIT`. Keep newer spelling/time and union
 * server ids so forgetting removes all represented rows.
 */
export function dedupeRecents(entries: RecentSearch[], now: Date = new Date()): RecentSearch[] {
  const byKey = new Map<string, RecentSearch>();

  for (const entry of entries) {
    const query = normalizeQuery(entry.query ?? '');
    if (!query) continue;

    const media = entry.media?.publicId ? entry.media : undefined;
    const key = recentKey({ query, media });
    const searchedAt = clampTimestamp(entry.searchedAt, now);
    const ids = entry.ids ?? [];
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { query, searchedAt, ids: [...ids], ...(media ? { media } : {}) });
      continue;
    }

    const isNewer = searchedAt > existing.searchedAt;
    // The title is the same on both sides -- it is half the key -- so only its
    // name can differ, and a side that knows the name beats one that does not.
    // A row that arrived unnamed (a scoped search with no results to name it)
    // must not blank a label the other side has.
    const named = media?.name ? media : existing.media?.name ? existing.media : (media ?? existing.media);
    byKey.set(key, {
      query: isNewer ? query : existing.query,
      searchedAt: isNewer ? searchedAt : existing.searchedAt,
      ids: mergeIds(existing.ids, ids),
      ...(named ? { media: named } : {}),
    });
  }

  // Both sides are UTC ISO of the same width by now, so string order is time
  // order and there is no date parsing in the sort.
  return [...byKey.values()].sort((a, b) => (a.searchedAt < b.searchedAt ? 1 : -1)).slice(0, RECENTS_LIMIT);
}

/**
 * Time-scoped tombstones prevent older server rows outside the deletion window from resurrecting forgotten
 * searches; a newer search can reappear.
 */
export function applyDismissals(entries: RecentSearch[], dismissed: Record<string, string>): RecentSearch[] {
  if (Object.keys(dismissed).length === 0) return entries;
  return entries.filter((entry) => {
    const at = dismissed[recentKey(entry)];
    return !at || entry.searchedAt > at;
  });
}

/**
 * Narrow by query only, not title. An empty term keeps the recent list; title scope distinguishes otherwise
 * identical rows.
 */
export function narrowRecents(entries: RecentSearch[], term: string, limit = RECENTS_MENU_SIZE): RecentSearch[] {
  const needle = queryKey(term ?? '');
  const matches = needle ? entries.filter((entry) => queryKey(entry.query).includes(needle)) : entries;
  return matches.slice(0, limit);
}
