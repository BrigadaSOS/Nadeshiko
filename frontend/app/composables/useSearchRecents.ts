import { handleApiError } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import {
  applyDismissals,
  dedupeRecents,
  narrowRecents,
  normalizeQuery,
  recentKey,
  RECENTS_FETCH_SIZE,
  RECENTS_MENU_SIZE,
  type RecentSearch,
  type RecentSearchMedia,
} from '~/utils/searchRecents';

const STORAGE_KEY = 'nd-search-recents';

type StoredRecents = {
  v: 1;
  entries: RecentSearch[];
  /** Query key -> the moment it was forgotten. See `applyDismissals`. */
  dismissed: Record<string, string>;
};

/**
 * Coalesces the account fetch, and remembers that the device list has been read
 * back. Module-level, and safe to be: both only ever run from a click or a
 * rendered result, so neither is touched during SSR or shared between requests
 * -- the same reasoning as `useCollectionOptions`.
 */
let inFlight: Promise<void> | null = null;
let hydrated = false;

/**
 * The reader's last searches, for the recents menu under the search bar.
 *
 * **The device is the primary copy.** Every reader has a list in `localStorage`,
 * signed in or not, because a signed-out reader has nowhere else to keep one and
 * the list has to survive being offline. A signed-in reader's account rows
 * (`UserActivity` of type `SEARCH`, the same ones `/user/activity` lists) merge
 * into it, which is what makes the list follow them between devices. Syncing is
 * free: the only line here is signed-in versus signed-out.
 *
 * **Recording happens on arrival at results, never on submit** -- see
 * `SearchContainer`'s `trackSearch`. Most searches on the site are never typed
 * into the bar: a clicked token, a media tab, a link from Yomitan and a pasted
 * URL all arrive at the same place, and arrival is the one event they share.
 *
 * **Deleting always goes through here, on both paths.** The account's copy and
 * the device's copy have to go together: a row deleted only on the server is
 * still in this device's list, and the next search would file it again.
 */
export function useSearchRecents() {
  const user = userStore();

  const local = useState<RecentSearch[]>('nd-search-recents-local', () => []);
  const account = useState<RecentSearch[]>('nd-search-recents-account', () => []);
  const dismissed = useState<Record<string, string>>('nd-search-recents-dismissed', () => ({}));
  const loading = useState<boolean>('nd-search-recents-loading', () => false);
  const clearing = useState<boolean>('nd-search-recents-clearing', () => false);
  /**
   * Who the loaded account rows belong to, rather than a bare "loaded" flag:
   * signing in or out mid-session has to send `load` back to the API (or to
   * nobody), and a flag would have left the previous reader's rows in the menu.
   */
  const loadedFor = useState<string | null>('nd-search-recents-loaded-for', () => null);
  const identity = computed(() => (user.isLoggedIn ? (user.userEmail ?? 'account') : 'anonymous'));

  /**
   * Whether new searches are written down. The account's toggle governs the
   * device list too, so turning it off on one device stops the recording the
   * reader can actually see. It does not erase: stopping and forgetting are
   * different requests, so what is already stored stays until they clear it.
   */
  const isRecording = computed(() => user.preferences?.searchHistory?.enabled !== false);

  const recents = computed<RecentSearch[]>(() => {
    // Guarded on `isLoggedIn` as well as cleared on load, so signing out drops
    // the account's half of the list on the spot rather than at the next open.
    const fromAccount = user.isLoggedIn ? applyDismissals(account.value, dismissed.value) : [];
    return dedupeRecents([...local.value, ...fromAccount]);
  });

  const persist = () => {
    if (!import.meta.client) return;
    try {
      const payload: StoredRecents = { v: 1, entries: local.value, dismissed: dismissed.value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // A full quota or a browser in private mode. The menu keeps working for
      // this page; there is nothing here worth interrupting a search over.
      reportError('search-recents:persist-failed', error);
    }
  };

  /** Reads the device list back, once per session. */
  const hydrate = () => {
    if (!import.meta.client || hydrated) return;
    hydrated = true;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as Partial<StoredRecents>;
      local.value = dedupeRecents(Array.isArray(parsed.entries) ? parsed.entries : []);
      dismissed.value = parsed.dismissed && typeof parsed.dismissed === 'object' ? parsed.dismissed : {};
    } catch {
      // Hand-edited or from a shape this version does not know; the reader
      // starts a fresh list rather than seeing the menu fail to open.
      local.value = [];
      dismissed.value = {};
    }
  };

  const fetchAccountRecents = async () => {
    loading.value = true;
    try {
      const data = await useNadeshikoSdk().listUserActivity({ activityType: 'SEARCH', take: RECENTS_FETCH_SIZE });
      account.value = (data.activities ?? [])
        .filter((activity) => !!activity.searchQuery)
        .map((activity) => ({
          query: activity.searchQuery,
          searchedAt: activity.createdAt,
          ids: [activity.id],
          // The scope was already storable: `UserActivity` has carried these two
          // columns since long before this feature, they were simply never sent
          // for a SEARCH row.
          ...(activity.mediaPublicId
            ? {
                media: {
                  publicId: activity.mediaPublicId,
                  ...(activity.mediaName ? { name: activity.mediaName } : {}),
                },
              }
            : {}),
        }));
      loadedFor.value = identity.value;
    } catch (error) {
      // Silent: the device's own list is already on screen, and a reader who
      // opened the box to search does not need a toast about the half of the
      // menu they cannot see being missing. `loadedFor` is left alone, so the
      // next open retries.
      reportError('search-recents:account-fetch-failed', error);
      account.value = [];
    } finally {
      loading.value = false;
    }
  };

  /**
   * Loads what the menu needs. Called when the menu is first opened rather than
   * on mount, so the bar -- which renders on four pages, including cached ones
   * -- costs no request until a reader asks for their history.
   */
  const load = async (): Promise<void> => {
    if (!import.meta.client) return;
    hydrate();

    if (!user.isLoggedIn) {
      account.value = [];
      loadedFor.value = identity.value;
      return;
    }
    if (loadedFor.value === identity.value) return;
    if (inFlight) return inFlight;

    inFlight = fetchAccountRecents().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  /**
   * Files a search on this device. The account's copy is written separately by
   * `trackSearch`, through the activity endpoint; this is the half that a
   * signed-out reader gets and the half that survives being offline.
   */
  const remember = (raw: string, media?: RecentSearchMedia) => {
    if (!import.meta.client || !isRecording.value) return;

    const query = normalizeQuery(raw);
    if (!query) return;

    hydrate();
    const entry: RecentSearch = {
      query,
      searchedAt: new Date().toISOString(),
      ids: [],
      ...(media?.publicId ? { media } : {}),
    };

    const key = recentKey(entry);
    if (dismissed.value[key]) {
      // Searched again after being forgotten. The tombstone has done its job
      // and would now be holding back rows the reader has asked for.
      const { [key]: _forgotten, ...rest } = dismissed.value;
      dismissed.value = rest;
    }

    local.value = dedupeRecents([entry, ...local.value]);
    persist();
  };

  /**
   * Forgets one entry, on both copies. The tombstone covers the account rows
   * this device never saw the ids of -- see `applyDismissals`.
   */
  const forget = async (entry: RecentSearch) => {
    const key = recentKey(entry);

    // By key, so forgetting 食べる inside one title leaves the general 食べる
    // alone: they are two rows because they are two searches.
    local.value = local.value.filter((item) => recentKey(item) !== key);
    account.value = account.value.filter((item) => recentKey(item) !== key);
    dismissed.value = { ...dismissed.value, [key]: new Date().toISOString() };
    persist();

    if (!user.isLoggedIn || entry.ids.length === 0) return;

    const sdk = useNadeshikoSdk();
    await Promise.all(
      entry.ids.map((id) =>
        sdk.deleteUserActivityById(id).catch((error: unknown) => {
          // The entry is already gone from the menu and stays gone on this
          // device; a failed row delete only means the account still holds it.
          reportError('search-recents:forget-failed', error);
        }),
      ),
    );
  };

  /**
   * Empties the list. The account is asked first and the device is wiped only
   * once it answers: a clear that emptied the browser while the account still
   * held the rows is a privacy bug wearing a sync bug's coat.
   */
  const clear = async () => {
    if (clearing.value) return;

    if (user.isLoggedIn) {
      clearing.value = true;
      try {
        await useNadeshikoSdk().deleteUserActivity({ activityType: 'SEARCH' });
      } catch (error) {
        handleApiError('search-recents:clear-failed', error, { toastKey: 'searchRecents.clearError' });
        return;
      } finally {
        clearing.value = false;
      }
    }

    local.value = [];
    account.value = [];
    // Nothing left to hold back, and the map would otherwise outlive every
    // entry it was written for.
    dismissed.value = {};
    persist();
  };

  /** The rows the menu shows for what is currently in the box. */
  const narrow = (term: string, limit = RECENTS_MENU_SIZE) => narrowRecents(recents.value, term, limit);

  return { recents, loading, clearing, isRecording, load, remember, forget, clear, narrow };
}
