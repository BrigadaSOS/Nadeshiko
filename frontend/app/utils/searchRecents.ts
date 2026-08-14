/**
 * The reader's own last searches, as the bar's recents menu reads them.
 *
 * Two sources feed one list: this device's `localStorage`, which every reader
 * has including a signed-out one, and the account's `UserActivity` SEARCH rows,
 * which follow a signed-in reader between devices. Everything here is the pure
 * half -- merging, narrowing, forgetting -- so it can be tested without a store,
 * an SDK or a browser; `useSearchRecents` owns the two sources themselves.
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
 * How many raw activity rows to ask the account for. Deliberately larger than
 * `RECENTS_LIMIT`: the API returns one row per search event, so a reader who
 * looks the same word up every morning would otherwise spend the whole window
 * on one entry.
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
 * What makes two entries the same entry: the query **and** what it was searched
 * inside. 食べる everywhere and 食べる in one title are two searches a reader
 * ran deliberately and would run again separately, so they are two rows.
 *
 * The episode is not part of it, and neither is the tab: those narrow a search
 * the reader had already decided on. The title is the search.
 *
 * NUL-joined rather than joined with any printable character, since a query can
 * contain whitespace and punctuation: `食べる` unscoped must not key the same as
 * `食べ` inside a title whose id is `る`.
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
 * One entry per query, newest first, capped at `RECENTS_LIMIT`.
 *
 * Feed it both lists at once: the account's rows arrive undeduped (one per
 * search event) and the device's list overlaps them almost entirely, so the
 * merge and the dedupe are the same pass. Whichever side is newer supplies the
 * timestamp and the spelling; the ids are unioned, because either side may know
 * about server rows the other does not.
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
 * Drops account rows the reader has already forgotten on this device.
 *
 * Forgetting deletes the server rows it knows the ids of, but the menu only
 * ever holds the ids from the last fetch window: an older row for the same
 * query survives the delete and would climb back into the list on the next
 * load. The tombstone is what keeps a forget looking like a forget. It is
 * scoped by time rather than absolute, so running the same search again brings
 * the entry back -- forgetting is not a block list.
 */
export function applyDismissals(entries: RecentSearch[], dismissed: Record<string, string>): RecentSearch[] {
  if (Object.keys(dismissed).length === 0) return entries;
  return entries.filter((entry) => {
    const at = dismissed[recentKey(entry)];
    return !at || entry.searchedAt > at;
  });
}

/**
 * The rows the menu shows for what is currently in the box.
 *
 * An empty box is the unnarrowed case of the same list rather than a state of
 * its own, which is what keeps the menu useful on a results page, where the bar
 * arrives prefilled with the query that answered it.
 *
 * Matched on the query alone, never on the title: the reader is typing what they
 * searched for, so 食 has to keep both the general 食べる and the one they ran
 * inside a show -- the title tells those two rows apart, it does not hide one.
 */
export function narrowRecents(entries: RecentSearch[], term: string, limit = RECENTS_MENU_SIZE): RecentSearch[] {
  const needle = queryKey(term ?? '');
  const matches = needle ? entries.filter((entry) => queryKey(entry.query).includes(needle)) : entries;
  return matches.slice(0, limit);
}
