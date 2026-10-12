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
 * Load the study ranking server-side into useState so hydration preserves filter order. Load
 * once per session rather than per query.
 */
export function useFamiliarMedia() {
  const entries = useState<FamiliarMediaEntry[]>('familiar-media', () => []);

  /**
   * Resolve request-bound SDK and Pinia context during setup, not inside useAsyncData handlers.
   * This hardens an observed, non-reproducible SSR context failure.
   */
  const user = userStore();
  const sdk = useNadeshikoSdk();

  /** publicId -> position in the ranking; the comparator's tier-1 order. */
  const inferredRank = computed<Map<string, number>>(
    () => new Map(entries.value.map((entry, index) => [entry.media.publicId, index])),
  );

  /**
   * Return the ranking, including [] when signed out, so useAsyncData caches it. Returning
   * undefined would cause a client hydration refetch.
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
   * Drop the title after server confirmation without refetching the ranking. Forgetting is not
   * a blocklist: later study starts a new tally.
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

  // No bulk `clear` here. `ac04d42ed` replaced the one "Forget which shows I
  // study" button with a Forget on each row, so nothing has called it since --
  // it sat exported and unreachable, holding the last reference to a toast
  // string. `DELETE /v1/user/familiar-media` is untouched and still the way to
  // empty the tally in one call if a caller ever wants one again.
  return { entries, inferredRank, load, forget };
}
