import { useTimeoutFn } from '@vueuse/core';
import type { MediaSummary } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';

const SEARCH_MAX_RESULTS = 25;
const DEBOUNCE_MS = 120;

/**
 * Debounced catalogue lookup for the account's media settings.
 *
 * There used to be one of these inside the favorites panel and an identical one
 * inside the hidden-media panel -- same debounce, same `take`, same failure
 * handling -- which is what made `/user/media` render two search boxes asking
 * the backend the same question. One search now feeds both actions.
 *
 * `failed` is deliberately separate from "nothing matched": a search outage must
 * not read as an empty catalogue, which is what a single empty-results state
 * would have said.
 */
export function useMediaSearch(reportKey: string) {
  const sdk = useNadeshikoSdk();

  const query = ref('');
  const results = ref<MediaSummary[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  // Restarted on each keystroke, and cancelled on unmount by `useTimeoutFn`.
  const { start: scheduleSearch, stop: cancelSearch } = useTimeoutFn(
    async (trimmedQuery: string) => {
      loading.value = true;
      failed.value = false;
      try {
        const response = await sdk.searchMedia({ query: trimmedQuery, take: SEARCH_MAX_RESULTS });
        results.value = response.media;
      } catch (error) {
        handleApiError(reportKey, error, { toastKey: false });
        results.value = [];
        failed.value = true;
      } finally {
        loading.value = false;
      }
    },
    DEBOUNCE_MS,
    { immediate: false },
  );

  const clear = () => {
    cancelSearch();
    results.value = [];
    failed.value = false;
  };

  watch(query, (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      clear();
      return;
    }
    scheduleSearch(trimmed);
  });

  return { query, results, loading, failed };
}
