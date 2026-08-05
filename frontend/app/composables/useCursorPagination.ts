// Explicit imports rather than Nuxt's auto-imports: this module is unit-tested
// outside Nuxt, same as `useSearchFetch`.
import { ref } from 'vue';
import { createRequestSequencer } from './useSearchFetch';

/**
 * The pagination fields every cursor endpoint returns. Fetchers hand back their
 * own payload on top of these, so callers keep whatever else came with the page.
 *
 * `hasMore` is optional: endpoints that only return a cursor (and stop sending
 * one at the end) get the same behaviour from cursor presence alone.
 */
export type CursorPage = {
  cursor?: string | null;
  hasMore?: boolean;
};

/**
 * Fetches one page. `cursor` is `null` for the first page of a fresh list.
 * Return `null` to report a failure — the composable keeps the current cursor
 * and lets the caller decide what the list should show.
 */
export type CursorPageFetcher<T extends CursorPage> = (cursor: string | null) => Promise<T | null>;

/**
 * `stale` means the page must be dropped on the floor: either a newer request
 * superseded it, or the call never ran because one was already in flight.
 */
export type CursorPageOutcome<T> = { status: 'ok'; page: T } | { status: 'stale' } | { status: 'error' };

/**
 * Cursor pagination for a list whose query can change under an in-flight
 * request — a filter switch, a tab change, a new search. Every fetch runs in a
 * generation (see `createRequestSequencer`), so starting a fresh list
 * invalidates the page that was already on its way and its results can never be
 * appended to, or its cursor written over, the new list.
 *
 * The caller keeps ownership of the items; this only owns the cursor, the
 * end-of-list flag and the two in-flight flags.
 */
export function useCursorPagination() {
  const cursor = ref<string | null>(null);
  const hasMore = ref(false);
  /** A fresh list is being fetched. */
  const loading = ref(false);
  /** The next page is being appended. */
  const loadingMore = ref(false);

  const requests = createRequestSequencer();

  const run = async <T extends CursorPage>(
    append: boolean,
    fetchPage: CursorPageFetcher<T>,
  ): Promise<CursorPageOutcome<T>> => {
    const generation = requests.start();
    const requestCursor = append ? cursor.value : null;

    if (append) {
      loadingMore.value = true;
    } else {
      loading.value = true;
      loadingMore.value = false;
    }

    let page: T | null;
    try {
      page = await fetchPage(requestCursor);
    } finally {
      // A newer generation owns these now and clears them itself.
      if (requests.isCurrent(generation)) {
        loading.value = false;
        loadingMore.value = false;
      }
    }

    if (!requests.isCurrent(generation)) {
      return { status: 'stale' };
    }
    if (!page) {
      return { status: 'error' };
    }

    // An empty cursor means the same thing as a missing one: the list is exhausted.
    cursor.value = page.cursor || null;
    hasMore.value = page.hasMore ?? cursor.value !== null;

    return { status: 'ok', page };
  };

  return {
    cursor,
    hasMore,
    loading,
    loadingMore,
    /** Starts a fresh list, cancelling and invalidating whatever was in flight. */
    load: <T extends CursorPage>(fetchPage: CursorPageFetcher<T>) => run(false, fetchPage),
    /**
     * Appends the next page. Steps aside while another fetch is running rather
     * than cancelling it, since two pages of the same list are both wanted.
     */
    loadMore: async <T extends CursorPage>(fetchPage: CursorPageFetcher<T>): Promise<CursorPageOutcome<T>> => {
      if (loading.value || loadingMore.value || !hasMore.value || !cursor.value) {
        return { status: 'stale' };
      }
      return run(true, fetchPage);
    },
    /**
     * Adopts a page fetched elsewhere — an SSR-primed first page, or a reset
     * after the list was emptied. Invalidates anything in flight, so a pending
     * page cannot land on top of it.
     */
    seed(page: CursorPage | null | undefined) {
      requests.cancel();
      loading.value = false;
      loadingMore.value = false;
      cursor.value = page?.cursor || null;
      hasMore.value = page?.hasMore ?? cursor.value !== null;
    },
  };
}
