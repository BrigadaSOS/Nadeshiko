import { handleApiError } from '~/utils/apiError';
// Explicitly imported: the bare name resolves to the DOM's one-argument
// `reportError` global instead of ours.
import { reportError } from '~/utils/reportError';

export type FamiliarMediaEntry = {
  media: { publicId: string; nameEn?: string; nameJa?: string; nameRomaji?: string };
  score: number;
  ankiCount: number;
  playCount: number;
  shareCount: number;
};

/**
 * The titles the reader studies most, as the search filter orders by them.
 *
 * Held in `useState` rather than fetched from the filter component, and that
 * placement is the whole point: the search page loads this server-side alongside
 * its other data, `useState` rides the Nuxt payload to the client, and hydration
 * therefore reproduces exactly the order the server rendered. Fetching it from
 * the component instead would order the list alphabetically on the server and
 * re-sort it a moment later in the browser -- a reshuffle under the cursor of
 * someone already reaching for a row.
 *
 * Fetched once per session, not per query: the ranking is about months of study
 * and does not move between two searches. A title studied mid-session shows up
 * on the next load, which is soon enough.
 */
export function useFamiliarMedia() {
  const entries = useState<FamiliarMediaEntry[]>('familiar-media', () => []);

  /**
   * Resolved here, while the composable is being set up, and NOT inside `load`.
   *
   * `load` is called from inside `useAsyncData` handlers, and a handler is not
   * guaranteed to run with the active Pinia instance or the Nuxt request context
   * that `userStore()` and `useNadeshikoSdk()` reach for. A server render of
   * `/user/activity` was once observed failing exactly that way -- the payload
   * carried `getActivePinia() was called but there was no active Pinia` as a
   * `NuxtError` in place of the whole initial load, taking the stats, history
   * and heatmap down with the ranking and sending the client off to re-fetch all
   * four.
   *
   * Stated as it is rather than as a fixed bug: that failure has not been
   * reproducible on demand since, so this is hardening on the documented-correct
   * pattern (resolve context-bound composables during setup, use them later)
   * rather than a change with a red-to-green test behind it. Both values are
   * stable for the life of the component -- the store is reactive, the SDK is
   * bound to the request being rendered -- so holding them costs nothing.
   */
  const user = userStore();
  const sdk = useNadeshikoSdk();

  /** publicId -> position in the ranking; the comparator's tier-1 order. */
  const inferredRank = computed<Map<string, number>>(
    () => new Map(entries.value.map((entry, index) => [entry.media.publicId, index])),
  );

  /**
   * Returns the ranking as well as storing it, and the return value is the part
   * that matters to the caller on the search page.
   *
   * That page loads this through `useAsyncData`, whose payload entry is the
   * handler's return value. A handler returning nothing leaves `undefined`
   * there, Nuxt's default `getCachedData` reads `undefined` as "nothing was
   * cached", and hydration therefore re-runs the handler -- fetching on the
   * client the ranking the server had already fetched into the very payload
   * being hydrated. Returning the entries (including the empty array a
   * signed-out reader gets) is what makes that a cache hit instead.
   */
  const load = async (): Promise<FamiliarMediaEntry[] | undefined> => {
    if (!user.isLoggedIn) {
      // A real answer rather than a failure: nobody is signed in, so there is no
      // ranking, and that is worth caching like any other result.
      entries.value = [];
      return entries.value;
    }

    try {
      const data = await sdk.listFamiliarMedia();
      entries.value = (data?.familiarMedia ?? []) as FamiliarMediaEntry[];
      return entries.value;
    } catch (error) {
      // Ordering is an enhancement; a filter sorted alphabetically is the
      // fallback, and it is a perfectly good list. Never surface a toast.
      reportError('familiar-media:fetch-failed', error);
      entries.value = [];
      // Deliberately `undefined`, and it is the one case that returns nothing.
      // A server render that cannot authenticate for this owner-scoped route
      // lands here, and `undefined` is what stops `useAsyncData` from writing a
      // failure into the payload: the client then retries instead of hydrating
      // an empty ranking it would never correct.
      return undefined;
    }
  };

  /**
   * Forgets one title, leaving the rest of the tally standing.
   *
   * The whole-tally clear is the blunt instrument; this is for a single show the
   * tally read wrong. The row leaves the list as soon as the server answers
   * rather than after a refetch -- re-reading the whole ranking to drop one row
   * would make this feel slower than the clear beside it.
   *
   * Forgetting does not blocklist: the next export or share against that title
   * starts a fresh tally, which is the honest behaviour for a running count.
   */
  const forget = async (mediaPublicId: string): Promise<boolean> => {
    try {
      await sdk.forgetFamiliarMedia({ mediaPublicId });
      entries.value = entries.value.filter((entry) => entry.media.publicId !== mediaPublicId);
      return true;
    } catch (error) {
      handleApiError('familiar-media:forget-failed', error, { toastKey: 'familiarMedia.forgetError' });
      return false;
    }
  };

  /**
   * The number forgotten, or `null` when the clear failed -- which a count of 0
   * cannot say on its own, since clearing an empty tally succeeds and forgets
   * nothing. Callers that confirm the action need the two kept apart.
   */
  const clear = async (): Promise<number | null> => {
    try {
      const data = await sdk.clearFamiliarMedia();
      entries.value = [];
      return data?.count ?? 0;
    } catch (error) {
      handleApiError('familiar-media:clear-failed', error, { toastKey: 'familiarMedia.clearError' });
      return null;
    }
  };

  return { entries, inferredRank, load, forget, clear };
}
