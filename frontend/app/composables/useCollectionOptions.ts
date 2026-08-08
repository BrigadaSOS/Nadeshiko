import { handleApiError } from '~/utils/apiError';

export type CollectionOption = {
  id: string;
  name: string;
};

const LAST_COLLECTION_KEY = 'nd-last-collection';

/**
 * Coalesces concurrent loads into one request.
 *
 * Module-level, and safe to be: `load()` only ever runs from a click, so this is
 * never touched during SSR and never shared between requests. Same reasoning as
 * the module-level scope in `useTranslationVisibility`.
 */
let inFlight: Promise<void> | null = null;

/** Whether the remembered collection has been read back from localStorage yet. */
let restored = false;

/**
 * The reader's collections, as the "add to collection" picker on a result card
 * needs them.
 *
 * Shared across every card on the page, which is the whole point. This lived
 * inside the card component, so its "already loaded" guard was per instance: a
 * page of thirty results would fetch the same list thirty times over, once for
 * each dropdown the reader happened to open, and a failure toasted once per card.
 * The list belongs to the reader, not to the card, so it is stored per page.
 */
export function useCollectionOptions() {
  const user = userStore();

  const collections = useState<CollectionOption[]>('nd-collection-options', () => []);
  const loading = useState<boolean>('nd-collection-options-loading', () => false);
  const loaded = useState<boolean>('nd-collection-options-loaded', () => false);
  const lastCollection = useState<CollectionOption | null>('nd-collection-options-last', () => null);

  /** The collection a quick-add would go to, read back from the last session. */
  const restoreLastCollection = () => {
    if (!import.meta.client || restored) return;
    restored = true;

    const stored = localStorage.getItem(LAST_COLLECTION_KEY);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);
      if (parsed?.id && parsed?.name) {
        lastCollection.value = { id: parsed.id, name: parsed.name };
      }
    } catch {
      // Hand-edited or stale localStorage; the quick-add shortcut just stays hidden.
      lastCollection.value = null;
    }
  };

  const rememberLast = (collection: CollectionOption) => {
    lastCollection.value = collection;
    localStorage.setItem(LAST_COLLECTION_KEY, JSON.stringify(collection));
  };

  const fetchCollections = async () => {
    loading.value = true;
    try {
      const data = await useNadeshikoSdk().listCollections({ take: 100 });
      const items = data.collections
        .filter((c) => c.type !== 'ANKI_EXPORT')
        .map((c) => ({ id: c.publicId, name: c.name }));
      collections.value = items;
      loaded.value = true;

      if (lastCollection.value) {
        const stillValid = items.some((c) => c.id === lastCollection.value?.id);
        if (!stillValid) {
          lastCollection.value = null;
          localStorage.removeItem(LAST_COLLECTION_KEY);
        }
      }

      if (!lastCollection.value && items.length > 0) {
        const defaultItem = items[0];
        if (defaultItem) lastCollection.value = { id: defaultItem.id, name: defaultItem.name };
      }
    } catch (error) {
      // The picker would otherwise open on an empty list reading as "no collections
      // yet". `loaded` stays false so the next open retries.
      handleApiError('collections:picker-load-failed', error, {
        toastKey: 'searchpage.main.labels.collectionsLoadFailed',
      });
      collections.value = [];
      loaded.value = false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Loads the list once per page. A second caller while the first is still in
   * flight waits on the same request rather than starting another -- opening two
   * pickers in quick succession is one round trip, not two.
   */
  const load = async (): Promise<void> => {
    if (!user.isLoggedIn || loaded.value) return;
    if (inFlight) return inFlight;

    inFlight = fetchCollections().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return { collections, loading, loaded, lastCollection, load, rememberLast, restoreLastCollection };
}
