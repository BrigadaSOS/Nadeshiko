<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import { mdiRefresh, mdiEyeOff } from '@mdi/js';
import type { RouteLocationNormalized, LocationQueryValue } from 'vue-router';

import { usePlayerStore } from '~/stores/player';
import { userStore } from '~/stores/auth';
import { CATEGORY_API_MAPPING, CATEGORY_LABEL_KEYS, CATEGORY_SLUGS, discountHiddenMedia } from '~/utils/categories';
import { buildHiddenBreakdown, countHiddenResults, type HiddenBreakdownRow } from '~/utils/hiddenResults';
import { decodeSearchQuery, splitLocalePrefix } from '~/utils/routes';
import { EPISODE_HITS_LOADING, type SearchScope } from '~/composables/useSearchFetch';
import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { SearchResponse, SearchStatsResponse, ResolvedMediaStats, ResolvedCategoryCount } from '~/types/search';

const { mediaName } = useMediaName();
const { hiddenMediaIds, hiddenMediaExcludeFilter, isMediaHidden } = useHiddenMedia();
const { hiddenCategories, isCategoryHidden } = useHiddenCategories();
const { defaultCategorySlug } = useDefaultSearchCategory();
const searchRecents = useSearchRecents();

const props = defineProps<{
  initialSentenceData?: SearchResponse | null;
  initialStatsData?: SearchStatsResponse | null;
  listMediaIds?: number[] | null;
  collectionId?: string | null;
  collectionName?: string | null;
  /** Resolved title name for a `?media=` filter that has no matching rows. */
  mediaDisplayName?: string | null;
  /**
   * The title being browsed, when the ROUTE names it rather than the query
   * string -- i.e. on `/media/<slug>`, where the scope is in the path and there
   * is no `?media=` to read. Everywhere else this is absent and the media scope
   * comes off the URL as before.
   */
  mediaPublicId?: string | null;
}>();

const { t } = useI18n();
const localePath = useLocalePath();
const sdk = useNadeshikoSdk();
const { fetchSentences, fetchStats, cancelSentences } = useSearchFetch();
const posthog = usePostHog();
const signupNudge = useSignupNudge();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const route = useRoute();
const { setQuery } = useQuerySync();
const playerStore = usePlayerStore();

const isSentencePath = (path: string) => splitLocalePrefix(path).localizedPath.startsWith('/sentence/');

const sentenceData = ref<SearchResponse | null>(props.initialSentenceData ?? null);
const statsData = ref<SearchStatsResponse | null>(props.initialStatsData ?? null);
const isLoading = ref(false);
const endOfResults = ref(false);
const lastTrackedQuery = ref<string | null>(null);
const isSingleSentenceView = computed(() => isSentencePath(route.path));
const hasMoreResults = ref(!isSentencePath(route.path));
const showLoadMoreButton = ref(false);
const initialError = ref(false);
const statsError = ref(false);

const query = ref('');
const category = ref('all');
const cursor = ref<string | null>(null);
const media = ref<string | null>(null);
const sort = ref<string | null>(null);
const randomSeed = ref<number | null>(null);
const uuid = ref<string | null>(null);
const episode = ref<number | null>(null);

const categoryApiMapping = CATEGORY_API_MAPPING;
const selectedApiCategory = computed(() => categoryApiMapping[category.value] ?? null);
// A title is a refinement of a word search, not its replacement. Keep an
// explicit way back to the unscoped word results while a `?media=` filter is
// present; a title browse without a word still has just the title tab.
const hasSearchQuery = computed(() => Boolean(query.value));
const showHiddenMediaOverride = ref(false);

const isViewingHiddenMedia = computed(
  () => !!media.value && !showHiddenMediaOverride.value && isMediaHidden(media.value),
);

const showAnywayAndRefresh = () => {
  showHiddenMediaOverride.value = true;
  loadStats();
  loadSentences({ append: false });
};

/**
 * Lifts the reader's hidden-media and hidden-category lists for this search.
 *
 * A view, not a preference: it lasts until the query changes, the same way
 * `showHiddenMediaOverride` does for a title opened directly. Unhiding for good
 * is what the notice's link to the media settings is for.
 */
const revealHidden = ref(false);

const setRevealHidden = (next: boolean) => {
  posthog?.capture('hidden_results_toggled', {
    action: next ? 'revealed' : 'restored',
    // While revealed nothing is being kept out, so the live count is 0 and it is
    // the count that was on offer -- the size of what they chose to look at --
    // that the restore event has to carry.
    hidden_count: next ? hiddenResultCount.value : lastOfferedHiddenCount.value,
    query: query.value,
    category: category.value,
  });

  revealHidden.value = next;
  loadStats();
  loadSentences({ append: false });
};

/**
 * The titles behind the count, for the notice's popover: what the reader hides
 * that this query actually matched.
 *
 * Fetched only when they ask, and only once per search -- the list's own stats
 * come back with the hidden media already excluded, so naming them takes a
 * second request with the filters lifted, which is not worth spending on a
 * popover nobody opened.
 */
const hiddenBreakdown = ref<HiddenBreakdownRow[] | null>(null);
const hiddenBreakdownLoading = ref(false);
const hiddenBreakdownError = ref(false);

// Its own fetcher instance. `fetchStats` supersedes whatever the previous call
// left in flight, so sharing the list's would have the two mark each other stale.
const { fetchStats: fetchUnfilteredStats } = useSearchFetch();
// The empty-result check can run while the reader opens the breakdown, so it
// needs its own request generation too.
const { fetchStats: fetchHiddenEmptyStats } = useSearchFetch();

const loadHiddenBreakdown = async () => {
  posthog?.capture('hidden_results_breakdown_opened', {
    hidden_count: hiddenResultCount.value,
    query: query.value,
    category: category.value,
  });

  if (hiddenBreakdown.value || hiddenBreakdownLoading.value) return;

  hiddenBreakdownLoading.value = true;
  hiddenBreakdownError.value = false;

  const outcome = await fetchUnfilteredStats({
    ...searchScope.value,
    hiddenMediaExclude: [],
    hiddenCategories: [],
  });

  hiddenBreakdownLoading.value = false;

  if (outcome.status === 'stale') return;
  if (outcome.status !== 'ok') {
    hiddenBreakdownError.value = true;
    return;
  }

  // Built from the payload that came back with the filters lifted, which is the
  // only one carrying the hidden titles by name.
  hiddenBreakdown.value = buildHiddenBreakdown(
    {
      ...hiddenResultsScope.value,
      categories: outcome.data.categories ?? [],
      media: outcome.data.media ?? [],
    },
    { category: (entry) => t(CATEGORY_LABEL_KEYS[entry]), media: mediaName },
  );
};

/**
 * The selected title's per-episode counts, fetched on demand.
 *
 * The SSR payload stopped carrying them for anything but the title the page is
 * about (`stripEpisodeHits`), and picking a title deliberately does NOT refetch
 * the stats -- `statsScopeChanged` at the foot of this file is blind to
 * `?media=` on purpose, so the tabs keep describing the whole result set the
 * query matched. So the one title the reader drilled into is asked for on its
 * own: one bounded request in place of 242 titles' worth of counts on every
 * render. Filled by the watcher below, which is where `searchScope` exists.
 *
 * Nothing to fetch once a client-side `loadStats()` has run: that answer is not
 * serialized anywhere, so it still carries every title's breakdown and
 * `episodeHitsNeeded` finds nothing to ask for.
 */
const fetchedEpisodeHits = ref<{ mediaPublicId: string; hits: ResolvedMediaStats['episodeHits'] } | null>(null);
const episodeHitsLoading = ref(false);
// The drawer says so; it cannot reach this any other way. See EPISODE_HITS_LOADING.
provide(EPISODE_HITS_LOADING, readonly(episodeHitsLoading));

/** Puts a fetched breakdown back on the row the drawer reads it off. */
const withFetchedEpisodeHits = (entries: ResolvedMediaStats[]): ResolvedMediaStats[] => {
  const fetched = fetchedEpisodeHits.value;
  if (!fetched) return entries;

  return entries.map((entry) =>
    entry.mediaPublicId === fetched.mediaPublicId && entry.episodeHits.length === 0
      ? { ...entry, episodeHits: fetched.hits }
      : entry,
  );
};

const searchData = computed(() => {
  const sentencePayload = sentenceData.value;
  const statsPayload = statsData.value;
  const hidden = new Set(revealHidden.value ? [] : hiddenMediaIds.value);

  const allMedia = statsPayload?.media || ([] as ResolvedMediaStats[]);
  const filteredMedia = hidden.size > 0 ? allMedia.filter((m) => !hidden.has(m.mediaPublicId)) : allMedia;
  const hiddenMediaInPayload = hidden.size > 0 ? allMedia.filter((m) => hidden.has(m.mediaPublicId)) : [];

  const serverCategories = statsPayload?.categories || ([] as ResolvedCategoryCount[]);
  const discounted =
    hiddenMediaInPayload.length > 0 ? discountHiddenMedia(serverCategories, hiddenMediaInPayload) : serverCategories;

  // The category aggregation is deliberately not scoped to the request's category
  // filter (see `discountHiddenMedia`), so a hidden category still comes back with
  // a bucket and would keep its tab -- and its count in "All". The one the reader
  // is currently looking at is kept: `?category=` overrides the hidden list, and a
  // selected tab that renders nowhere is worse than a tab they chose to open.
  const categories =
    hiddenCategories.value.length > 0 && !revealHidden.value
      ? discounted.filter((entry) => !isCategoryHidden(entry.category) || entry.category === selectedApiCategory.value)
      : discounted;

  return {
    results: sentencePayload?.results || [],
    cursor: sentencePayload?.pagination?.cursor,
    pagination: sentencePayload?.pagination,
    categories,
    media: withFetchedEpisodeHits(filteredMedia),
  };
});

/**
 * What the reader's own lists are keeping out of the results below, for the
 * notice that offers to lift them. The derivation, and the three cases it has to
 * keep apart, live in `~/utils/hiddenResults` where they are unit tested.
 */
const hiddenResultsScope = computed(() => ({
  categories: statsData.value?.categories ?? [],
  media: statsData.value?.media ?? [],
  hiddenMediaIds: hiddenMediaIds.value,
  hiddenCategories: hiddenCategories.value,
  selectedCategory: selectedApiCategory.value,
  hasMediaFilter: !!media.value,
}));

// Nothing is being kept out while the reader is looking past their filters, so
// the count is 0 by definition rather than by derivation.
const hiddenResultCount = computed(() => (revealHidden.value ? 0 : countHiddenResults(hiddenResultsScope.value)));

/**
 * A search that came back with nothing, for a reader who hides something.
 *
 * The server drops a category bucket once its last hit is excluded, so where the
 * partial case above has `realCount` to subtract from, this one has no payload
 * left to count at all. `hiddenEmptyMatchCount` is filled by a second request
 * with those filters lifted, so a genuinely empty query does not get a notice
 * that promises results it cannot reveal.
 */
/** Result count from a filters-lifted check for an otherwise empty search. */
const hiddenEmptyMatchCount = ref<number | null>(null);

const hiddenMayExplainEmpty = computed(() => hiddenEmptyMatchCount.value !== null && hiddenEmptyMatchCount.value > 0);

/** Whether the notice is offering to lift the filters, rather than reporting they are lifted. */
const hiddenNoticeOffered = computed(() => hiddenResultCount.value > 0 || hiddenMayExplainEmpty.value);

/** The count the notice last offered, for the events fired once it reads 0. */
const lastOfferedHiddenCount = ref(0);

/** The search this impression was last recorded for. */
const lastNoticeImpression = ref<string | null>(null);

/**
 * Impressions as well as clicks: how often the notice is acted on means nothing
 * without how often it was there to act on.
 *
 * Recorded once per search rather than once per appearance: the notice goes away
 * while the reader looks past their filters and comes back when they restore
 * them, and counting that as a second offer would understate every rate measured
 * against it.
 *
 * The separator is a NUL as an escape, never as a raw byte, for the reason
 * `trackSearch` gives below -- written literally it makes this file binary to
 * `grep -r`, `rg` and `file`, which then skip it silently.
 */
watch(
  () => (hiddenNoticeOffered.value ? `${query.value}\u0000${category.value}` : null),
  (key) => {
    if (!key || !import.meta.client) return;
    lastOfferedHiddenCount.value = hiddenResultCount.value;
    if (key === lastNoticeImpression.value) return;
    lastNoticeImpression.value = key;

    posthog?.capture('hidden_results_notice_shown', {
      hidden_count: hiddenResultCount.value,
      // The blank-page case, where the count is unknowable and the notice is the
      // only thing explaining an empty search.
      empty_results: hiddenMayExplainEmpty.value,
      query: query.value,
      category: category.value,
    });
  },
);

const animeTabName = computed(() => {
  if (props.collectionId) {
    return props.collectionName ?? t('searchContainer.collectionTabPrefix');
  }
  if (media.value) {
    const mediaStat = (searchData.value?.media || []).find((item) => item.mediaPublicId === media.value);
    const mediaSource = mediaStat || searchData.value?.results?.[0]?.media || null;

    if (mediaSource) {
      let name = mediaName(mediaSource);
      if (episode.value !== null) {
        name += `, ${t('searchpage.main.labels.episode')} ${episode.value}`;
      }
      return name;
    }

    return t('searchContainer.categoryAll');
  }

  const singleResult = searchData.value?.results;
  if (singleResult?.length === 1 && !query.value) {
    const media = singleResult[0]?.media;
    if (media) return mediaName(media);
  }

  return t('searchContainer.categoryAll');
});

const isSingleSegmentView = computed(() => {
  return searchData.value?.results?.length === 1 && !query.value && !media.value && !props.collectionId;
});

const getSearchQuery = (r: RouteLocationNormalized): string => {
  if (r.params?.query) {
    // The route parameter is raw. `decodeSearchQuery` keeps a malformed escape
    // from taking down this client-side container during setup or navigation.
    return decodeSearchQuery(String(r.params.query));
  }
  return typeof r.query?.query === 'string' ? r.query.query : '';
};

/**
 * What an absent `?category=` means here: the reader's default category, which
 * is `all` unless they picked one in settings.
 *
 * Three things are opened as themselves and so never take the default, because
 * it would quietly slice something that was asked for whole -- and, for a title
 * outside the default category, slice it down to nothing:
 *
 *   - a collection,
 *   - a permalinked sentence,
 *   - a title picked with `?media=`, the same way an explicit `?media=` already
 *     beats the reader's hidden-media list.
 */
const implicitCategorySlug = (r: RouteLocationNormalized): string => {
  const hasMediaFilter = getStringQueryValue(r.query?.media ?? r.query?.mediaId) !== null;
  return props.collectionId || hasMediaFilter || isSentencePath(r.path) ? 'all' : defaultCategorySlug.value;
};

/**
 * An explicit `?category=` is a choice and is honoured as given -- including
 * `all`, which is what the All tab writes once a non-`all` default exists, since
 * clearing the parameter would just hand the tab back to that default.
 */
const resolveCategorySlug = (r: RouteLocationNormalized): string => {
  const categoryParam = getStringQueryValue(r.query?.category);
  if (categoryParam === null) {
    return implicitCategorySlug(r);
  }
  return CATEGORY_SLUGS.includes(categoryParam) ? categoryParam : 'all';
};

const applyRouteQuery = (r: RouteLocationNormalized) => {
  query.value = getSearchQuery(r);
  const queryParams = r.query || {};
  category.value = resolveCategorySlug(r);
  // The prop wins where it is set: on `/media/<slug>` the title is the route, so
  // it must survive every query patch the filters make. A `?media=` on such a URL
  // would be a second, contradicting answer to which title this is -- the path is
  // the one that is canonical and indexed.
  media.value = props.mediaPublicId ?? getStringQueryValue(queryParams.media ?? queryParams.mediaId);
  sort.value = getStringQueryValue(queryParams.sort);
  uuid.value = getStringQueryValue(queryParams.uuid);

  // Only ever written alongside `sort=random`, and dropped with it. A negative
  // or non-numeric one is treated as absent rather than passed on: the API takes
  // non-negative integers, and a hand-edited URL should fall back to the
  // backend's own seed instead of failing the request.
  const seedParam = getStringQueryValue(queryParams.seed);
  const parsedSeed = seedParam === null ? Number.NaN : Number(seedParam);
  randomSeed.value = Number.isInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : null;

  const episodeParam = getStringQueryValue(queryParams.episode ?? queryParams.episodeId);
  if (episodeParam === null) {
    episode.value = null;
  } else {
    const parsedEpisode = Number(episodeParam);
    episode.value = Number.isNaN(parsedEpisode) ? null : parsedEpisode;
  }
};

applyRouteQuery(route);

const pageSize = computed(() => (props.collectionId ? COLLECTION_PAGE_SIZE : SEARCH_PAGE_SIZE));

const searchScope = computed<SearchScope>(() => ({
  query: query.value,
  category: category.value,
  mediaPublicId: media.value,
  episode: episode.value,
  sort: sort.value,
  randomSeed: randomSeed.value,
  segmentPublicId: uuid.value,
  collectionId: props.collectionId ?? null,
  listMediaIds: props.listMediaIds ?? null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  // Both lists come off the request while the reader is looking past them, so
  // the counts and the sidebar describe the list they are actually reading.
  hiddenMediaExclude: revealHidden.value ? [] : hiddenMediaExcludeFilter.value,
  hiddenCategories: revealHidden.value ? [] : hiddenCategories.value,
}));

/**
 * An empty visible payload cannot say whether a hidden title matched: its last
 * bucket was removed from the response. Ask once with the reader's hidden
 * filters lifted, then offer the notice only if that request actually found
 * something. A genuine zero-result search stays quiet.
 */
const hiddenEmptyCheckKey = computed(() => {
  const shouldCheck =
    !media.value &&
    !revealHidden.value &&
    !isLoading.value &&
    !statsError.value &&
    searchData.value.categories.length === 0 &&
    (hiddenMediaIds.value.length > 0 || hiddenCategories.value.length > 0);

  if (!shouldCheck) return null;
  return [query.value, category.value, hiddenMediaIds.value.join(','), hiddenCategories.value.join(',')].join('\u0000');
});

watch(
  hiddenEmptyCheckKey,
  async (key) => {
    hiddenEmptyMatchCount.value = null;
    // The server has no reader preferences during SSR. Deferring this second
    // request to the client also prevents the rendered page from briefly
    // claiming hidden results before it knows there are any.
    if (!key || !import.meta.client) return;

    const outcome = await fetchHiddenEmptyStats({
      ...searchScope.value,
      hiddenMediaExclude: [],
      hiddenCategories: [],
    });
    if (key !== hiddenEmptyCheckKey.value || outcome.status !== 'ok') return;

    hiddenEmptyMatchCount.value = outcome.data.categories.reduce((total, entry) => total + entry.count, 0);
  },
  { immediate: true },
);

// The breakdown describes one search; the next one has to ask again.
watch(searchScope, () => {
  hiddenBreakdown.value = null;
  hiddenBreakdownError.value = false;
});

// Its own fetcher instance, for the reason the two above have theirs: a shared
// `fetchStats` supersedes whatever the previous call left in flight, and the tab
// counts and this drill-down are answered by the same endpoint.
const { fetchStats: fetchEpisodeHits } = useSearchFetch();

/**
 * Which title, if any, is missing the episode list the drawer is about to show.
 *
 * Read off `statsData` rather than `searchData`, which is not a detail: the
 * merged copy is what `searchData` exposes, so keying this on it would clear the
 * need as soon as the answer arrived, drop the merge, and ask again forever.
 */
const episodeHitsNeeded = computed(() => {
  const id = media.value;
  if (!id) return null;
  const stat = statsData.value?.media?.find((entry) => entry.mediaPublicId === id);
  // No row means the query matched nothing inside this title -- there is no
  // episode list to drill into, and an empty one is the honest answer.
  return stat && stat.episodeHits.length === 0 ? id : null;
});

watch(
  episodeHitsNeeded,
  async (id) => {
    if (!id) {
      fetchedEpisodeHits.value = null;
      episodeHitsLoading.value = false;
      return;
    }
    if (fetchedEpisodeHits.value?.mediaPublicId === id) return;
    // Never on the server: the payload already holds the breakdown for the one
    // title a server render is about, and spending a second round trip to
    // re-serialize what was just stripped is the opposite of the point.
    if (!import.meta.client) return;

    fetchedEpisodeHits.value = null;
    episodeHitsLoading.value = true;

    const outcome = await fetchEpisodeHits({ ...searchScope.value, mediaPublicId: id }, { scopeToSelectedMedia: true });

    // A newer pick owns the state now, and started its own spinner.
    if (id !== episodeHitsNeeded.value) return;

    episodeHitsLoading.value = false;
    // A failed drill-down leaves the drawer saying the title has no episodes,
    // which is the same thing it said before this request existed.
    fetchedEpisodeHits.value =
      outcome.status === 'ok'
        ? { mediaPublicId: id, hits: outcome.data.media.find((entry) => entry.mediaPublicId === id)?.episodeHits ?? [] }
        : null;
  },
  { immediate: true },
);

const loadStats = async () => {
  const outcome = await fetchStats(searchScope.value);

  if (outcome.status === 'stale') {
    return;
  }
  if (outcome.status === 'forbidden') {
    await navigateTo(localePath('/'), { redirectCode: 302 });
    return;
  }
  if (outcome.status === 'error') {
    // The category tabs and the whole media/episode sidebar are driven by this
    // payload. An empty one is indistinguishable from a query that matched
    // nothing, and keeping the previous query's counts is worse still, so drop it
    // and let the template say what happened.
    statsData.value = null;
    statsError.value = true;
    return;
  }

  statsError.value = false;
  statsData.value = outcome.data;
};

const resetSentencePagination = () => {
  cursor.value = null;
  endOfResults.value = false;
  hasMoreResults.value = true;
  sentenceData.value = {
    ...sentenceData.value,
    results: [],
  };
};

const trackSearch = (response: SearchResponse) => {
  // Keyed by the title as well as the query: 食べる across everything and 食べる
  // inside one show are two searches, and switching between them by clicking a
  // media tab has to record the second one.
  // The separator is a NUL as an escape, never as a raw byte: written literally it
  // makes this file binary to `grep -r`, `rg` and `file`, which then skip it
  // silently -- the whole component drops out of every repo-wide search.
  const trackedKey = `${query.value}\u0000${media.value ?? ''}`;
  if (!import.meta.client || !query.value || trackedKey === lastTrackedQuery.value) {
    return;
  }
  lastTrackedQuery.value = trackedKey;

  let mediaId: string | null = null;
  let mediaNameValue: string | null = null;
  if (media.value) {
    mediaId = String(media.value);
    // The stats payload first: it names the title even when the search inside it
    // came back empty, which is exactly when the results have nothing to name.
    const mediaSource =
      searchData.value.media.find((item) => item.mediaPublicId === mediaId) ?? response?.results?.[0]?.media ?? null;
    if (mediaSource) {
      mediaNameValue = mediaName(mediaSource);
    }
  }

  const resultsCount = response?.pagination?.estimatedTotalHits ?? 0;
  const searchEventProps = {
    query: query.value,
    category: category.value,
    has_media_filter: !!media.value,
    media_id: mediaId,
    media_name: mediaNameValue,
    episode_number: episode.value,
    results_count: resultsCount,
  };

  // Recording happens here, on arrival at results, rather than on submit: most
  // searches are never typed into the bar -- a clicked token, a media tab, a
  // link from a dictionary extension and a pasted URL all end up here, and
  // arriving is the one event they share.
  searchRecents.remember(
    query.value,
    mediaId ? { publicId: mediaId, ...(mediaNameValue ? { name: mediaNameValue } : {}) } : undefined,
  );

  posthog?.capture('sentence_searched', searchEventProps);
  if (resultsCount === 0) {
    posthog?.capture('search_results_empty', searchEventProps);
  }

  // Counted on arrival at results for the same reason the event above is: a
  // search that was clicked, pasted or linked into is still a search, and
  // arriving is the one moment they all share.
  signupNudge.recordSearch();
  if (userStore().isLoggedIn) {
    // Fire-and-forget telemetry: never let it interrupt or warn about a search that
    // already rendered its results.
    sdk
      .trackUserActivity({
        activityType: 'SEARCH',
        searchQuery: query.value,
        // The scope, so the account's copy of a search knows what the device's
        // copy knows. `UserActivity` has carried both columns all along -- a
        // SEARCH row simply never sent them, which is why the history could not
        // tell a search inside a title from the same search across everything.
        ...(mediaId ? { mediaPublicId: mediaId } : {}),
        ...(mediaNameValue ? { mediaName: mediaNameValue } : {}),
      })
      .catch((error: unknown) => reportError('search:track-activity-failed', error));
  }
};

/**
 * `append: false` starts a fresh result list and cancels whatever was in
 * flight, so a route change always wins over the request it replaces.
 * `append: true` is the pagination path and steps aside while a fetch is
 * already running, since cancelling it would drop a page of results.
 */
const loadSentences = async ({ append }: { append: boolean }) => {
  if (isViewingHiddenMedia.value) {
    cancelSentences();
    sentenceData.value = { results: [] };
    endOfResults.value = true;
    hasMoreResults.value = false;
    isLoading.value = false;
    return;
  }

  if (append && (endOfResults.value || isLoading.value)) {
    return;
  }

  if (!append) {
    resetSentencePagination();
    playerStore.hidePlayer();
  }

  isLoading.value = true;
  showLoadMoreButton.value = false;

  const requestCursor = append ? cursor.value : null;
  const outcome = await fetchSentences(searchScope.value, { cursor: requestCursor });

  // A newer request owns the state now — it will clear `isLoading` itself.
  if (outcome.status === 'stale') {
    return;
  }

  if (outcome.status === 'forbidden') {
    isLoading.value = false;
    await navigateTo(localePath('/'), { redirectCode: 302 });
    return;
  }

  if (outcome.status === 'error') {
    if (!sentenceData.value?.results || sentenceData.value.results.length === 0) {
      initialError.value = true;
    }
    hasMoreResults.value = false;
    showLoadMoreButton.value = true;
    isLoading.value = false;
    return;
  }

  const response = outcome.data;
  const incomingResults = response.results || [];

  if (requestCursor === null) {
    sentenceData.value = {
      ...response,
      results: incomingResults,
    };
  } else {
    const previousResults = sentenceData.value?.results || [];
    sentenceData.value = {
      ...sentenceData.value,
      ...response,
      results: [...previousResults, ...incomingResults],
    };
  }

  const nextCursor = response.pagination?.cursor || null;
  const hasMore = response.pagination?.hasMore ?? false;
  cursor.value = nextCursor;

  if (!hasMore || !nextCursor || isSingleSentenceView.value) {
    endOfResults.value = true;
    hasMoreResults.value = false;
  } else {
    hasMoreResults.value = true;
  }

  initialError.value = false;
  if (requestCursor === null && !props.collectionId && !uuid.value) {
    trackSearch(response);
  }
  isLoading.value = false;
};

const loadMore = () => {
  posthog?.capture('search_load_more', {
    query: query.value,
    results_so_far: sentenceData.value?.results?.length ?? 0,
  });
  loadSentences({ append: true });
};

const getCategoryCount = (categoryKey: string): number => {
  if (media.value) {
    return searchData.value?.pagination?.estimatedTotalHits || 0;
  }

  const stats = searchData.value?.categories || [];

  if (categoryKey === 'all') {
    return stats.reduce((total, item) => total + item.count, 0);
  }

  const mappedCategory = categoryApiMapping[categoryKey];
  const item = stats.find((entry) => entry.category === mappedCategory);
  return item ? item.count : 0;
};

/**
 * Corpus baseline for the tab — count with the user-applied filters
 * (`?media=`, hidden-media exclusion) lifted. The `CommonTabsItem` only
 * renders the dual `count/totalCount` when this exceeds `getCategoryCount`.
 */
const getCategoryTotalCount = (categoryKey: string): number => {
  const stats = searchData.value?.categories || [];

  if (media.value || categoryKey === 'all') {
    return stats.reduce((total, item) => total + item.realCount, 0);
  }

  const mappedCategory = categoryApiMapping[categoryKey];
  const item = stats.find((entry) => entry.category === mappedCategory);
  return item ? item.realCount : 0;
};

/** Hits for the query across every visible title, including a zero-hit selected one. */
const unfilteredResultCount = computed(() =>
  (searchData.value?.categories || []).reduce((total, item) => total + item.count, 0),
);

/**
 * Label for the selected-title tab. A title whose hits for this query are zero
 * is absent from the stats payload, so its name cannot be resolved -- hence the
 * fallback, rather than `animeTabName`'s, which is "All" and would leave two
 * tabs sharing one name.
 */
const selectedMediaTabName = computed(() => {
  const stat = (searchData.value?.media || []).find((item) => item.mediaPublicId === media.value);
  const source = stat || searchData.value?.results?.[0]?.media || null;
  const name = source ? mediaName(source) : props.mediaDisplayName || t('searchContainer.selectedMediaFallback');
  return episode.value !== null ? `${name}, ${t('searchpage.main.labels.episode')} ${episode.value}` : name;
});

const categoryFilter = (categoryKey: string) => {
  posthog?.capture('search_filter_changed', {
    category: categoryKey,
    query: query.value,
  });

  // Dropping the parameter is how "All" is normally spelled, but with a default
  // category set that reads as "use the default" -- so All has to be written out.
  const clearsToAll = categoryKey === 'all' && implicitCategorySlug(route) === 'all';
  setQuery({ category: clearsToAll ? null : categoryKey });
};

/** Remove the title refinement without discarding the word in the route. */
const clearMediaFilter = () => {
  // With a non-All default, merely removing `?media=` would make the absent
  // category parameter resolve to that default. The reader clicked All, so
  // spell it explicitly in that one case.
  const categoryParam =
    category.value === 'all' && defaultCategorySlug.value !== 'all' ? 'all' : getStringQueryValue(route.query.category);
  setQuery({ media: null, episode: null, category: categoryParam });
};

const handleRemoveFromCollection = async (segmentPublicId: string) => {
  if (!props.collectionId) return;
  try {
    await sdk.removeSegmentFromCollection({
      collectionPublicId: props.collectionId,
      segmentPublicId,
    });
    // Remove from current results
    if (sentenceData.value?.results) {
      sentenceData.value = {
        ...sentenceData.value,
        results: sentenceData.value.results.filter((r) => r.segment.publicId !== segmentPublicId),
      };
    }
    // Refresh stats
    loadStats();
  } catch (error) {
    // The row stays on screen, which reads exactly like a no-op click.
    handleApiError('collections:remove-segment-failed', error, {
      toastKey: 'searchpage.main.labels.collectionRemoveFailed',
      context: { 'segment.publicId': segmentPublicId },
    });
  }
};

if (props.initialSentenceData) {
  cursor.value = props.initialSentenceData.pagination?.cursor || null;
  const initialResults = props.initialSentenceData.results || [];
  if (
    !props.initialSentenceData.pagination?.hasMore ||
    !props.initialSentenceData.pagination?.cursor ||
    initialResults.length < pageSize.value
  ) {
    endOfResults.value = true;
    hasMoreResults.value = false;
  }
}

/**
 * Cap the title sidebar at the remaining viewport, never stretch it to fill.
 *
 * A CSS `max-h: 100vh - tabs` is the stuck size, so at the top of the page a
 * long list hangs past the fold (and the page can still be scrolled to chase
 * it). Measuring the remaining viewport on scroll/resize stops it at the fold
 * at rest, and at the bottom once it sticks. A short list stays the height of
 * its rows -- a fixed height was stretching an empty card down the side.
 */
const sidebarRef = ref<HTMLElement | null>(null);
const sidebarMaxHeight = ref<string | undefined>(undefined);

const syncSidebarHeight = () => {
  const el = sidebarRef.value;
  if (!el || el.offsetParent === null) return;
  const top = el.getBoundingClientRect().top;
  const stickyTop = Number.parseFloat(getComputedStyle(el).top) || 0;
  // The column end is pushing the panel off: keep the stuck cap so we do
  // not grow it as it leaves.
  if (top + 1 < stickyTop) return;
  sidebarMaxHeight.value = `${Math.max(0, window.innerHeight - top)}px`;
};

useEventListener(window, 'scroll', syncSidebarHeight, { passive: true });
useEventListener(window, 'resize', syncSidebarHeight);
watch(
  () => searchData.value?.media?.length,
  () => nextTick(syncSidebarHeight),
);

onMounted(async () => {
  syncSidebarHeight();
  if (props.initialSentenceData == null) {
    await loadSentences({ append: false });
  } else if (!props.collectionId && !uuid.value) {
    // The server already answered this search, so `loadSentences` -- where a
    // search is normally recorded -- never runs, and the arrival went down
    // unrecorded: a link from a dictionary extension, a shared URL, a reload of
    // a results page. That is most of the ways a search reaches this page, and
    // it was silently missing from the account's activity too. Same guards as
    // the fetch path, and `trackSearch` still refuses a blank query and a
    // repeat of the one it last recorded.
    trackSearch(props.initialSentenceData);
  }

  if (props.initialStatsData == null) {
    loadStats();
  }
});

const forceSearchCounter = useState('force-search-counter', () => 0);

watch(forceSearchCounter, () => {
  loadStats();
  loadSentences({ append: false });
});

// The preference can land after this component has already picked a tab: an SSR
// pass that could not reach the backend leaves the session to the client, and
// until it answers the reader looks logged out and gets `all`.
watch(defaultCategorySlug, () => {
  if (getStringQueryValue(route.query.category) !== null) return;

  const resolved = implicitCategorySlug(route);
  if (resolved === category.value) return;

  category.value = resolved;
  loadStats();
  loadSentences({ append: false });
});

/**
 * Client-side route changes that this component has to answer itself.
 *
 * Not all of them, and the split is not a preference -- it is which navigations
 * remount the page underneath us. Nuxt builds its page key by interpolating the
 * matched route's `:params` (`generateRouteKey`), so `/search/:query` is part of
 * the key and the query string is not:
 *
 *   /search/彼女 -> /search/猫        key changes -> the page remounts, and the
 *                                    incoming copy fetches the new search from
 *                                    its own `useAsyncData`
 *   /search/彼女 -> ?category=anime   key is identical -> nothing remounts, and
 *                                    this guard is the only thing that fetches
 *
 * Answering the first kind here as well ran every search twice: two identical
 * `/v1/search` calls and two identical `/v1/search/stats` calls per token click,
 * ~190ms apart. The first pair also won the race and rendered, so its results
 * were torn down and rebuilt from the second pair's byte-identical payload --
 * and because this guard awaited that wasted fetch before letting the
 * navigation finish, it cost the URL, the search bar and the results another
 * ~190ms each on top.
 */
onBeforeRouteUpdate(async (to, from) => {
  applyRouteQuery(to);
  const searchQueryChanged = getSearchQuery(to) !== getSearchQuery(from);
  if (searchQueryChanged) {
    showHiddenMediaOverride.value = false;
    revealHidden.value = false;
  }

  // Compared as the page key is: the `:query` param alone. `getSearchQuery` also
  // reads `?query=`, which reaches this component without remounting it and so
  // still has to be fetched below.
  if (String(to.params.query ?? '') !== String(from.params.query ?? '')) {
    return;
  }

  const statsScopeChanged = searchQueryChanged || to.query.category !== from.query.category;

  if (statsScopeChanged) {
    loadStats();
  }

  await loadSentences({ append: false });
});
</script>

<template>
    <SearchSegmentSidebar :searchData="searchData" :categorySelected="category" :activeMediaId="media" :filterable="!isSingleSentenceView" />
    <div v-if="isViewingHiddenMedia" class="flex-1 mx-auto">
        <section class="w-full py-10 px-4">
            <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                <img class="mb-6" src="/assets/hidden-media.gif" :alt="$t('searchContainer.hiddenMediaImageAlt')" />
                <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchContainer.hiddenMediaNotice') }}</h1>
                <p class="mt-4 text-gray-500 dark:text-gray-400">{{ $t('searchContainer.hiddenMediaDescription') }}</p>
                <button
                    class="mt-6 px-5 py-2.5 rounded-lg text-sm font-medium border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                    @click="showAnywayAndRefresh()"
                >
                    {{ $t('searchContainer.hiddenMediaShowAnyway') }}
                </button>
            </div>
        </section>
    </div>
    <div v-else-if="initialError">
        <div class="pb-3">
            <div class="flex items-center justify-end gap-3 border-b border-b-line-subtle pb-3 px-4 md:px-0">
                <div class="shrink-0">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <section class="w-full">
            <div class="py-10 px-4">
                <div class="w-full align-top items-center">
                    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                        <img class="mb-6"
                            src="/assets/no-results.gif" :alt="$t('searchContainer.noResultsImageAlt')" />
                        <h2 class="font-bold text-red-400 text-3xl">{{ $t('searchContainer.errorTitle') }}</h2>
                        <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchContainer.errorMessage1') }}</h1>
                        <p class="mt-4 text-gray-500 dark:text-gray-400">{{ $t('searchContainer.errorMessage2') }}
                        </p>

                        <UiButtonPrimaryAction class="my-4" @click="loadSentences({ append: false })">
                            <template v-if="isLoading">
                                {{ $t('searchContainer.retrying') }}
                                <div role="status">
                                    <svg aria-hidden="true"
                                        class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                                        viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path
                                            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                                            fill="currentColor" />
                                        <path
                                            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                                            fill="currentFill" />
                                    </svg>
                                    <span class="sr-only">{{ $t('accountSettings.anki.loading') }}</span>
                                </div>

                            </template>
                            <template v-else>
                                <UiBaseIcon :path="mdiRefresh" />
                                {{ $t('searchContainer.retryButton') }}
                            </template>
                        </UiButtonPrimaryAction>
                    </div>
                </div>
            </div>
        </section>
    </div>
    <div v-else class="flex-1 mx-auto">
        <!-- Tabs. Sticky so the category tabs and the EN/ES/furigana controls
             stay reachable while reading results: they sit where the search bar
             leaves off, and the title sidebar starts below them. -->
        <!-- Keep All present for every word search, even one with no hits.
             It must not disappear after widening an empty title-scoped search
             to an equally empty search across everything. -->
        <div class="sticky top-0 z-30 bg-background pb-3 yomitan-ignore" v-if="searchData?.categories?.length > 0 || hasSearchQuery">
            <div data-testid="search-category-tabs" class="search-tabs-row flex items-center gap-2 border-b border-b-line-subtle px-4 md:gap-3 md:px-0">
                <div class="search-tabs-main min-w-0 flex-1">
                    <CommonTabsContainer>
                        <CommonTabsHeader :showBorder="false">
                            <!-- Inside the strip, as its first item, rather than
                                 beside it. Outside it was `shrink-0` next to a
                                 scroller, so it held its full width while the
                                 tabs scrolled underneath -- on a phone that left
                                 the tab itself clipped, and the link read as
                                 pinned rather than as part of the row. An `<li>`
                                 because the strip is a `<ul>`. -->
                            <li v-if="collectionId" class="shrink-0 flex items-center">
                                <NuxtLink
                                    :to="localePath('/user/collections')"
                                    class="inline-flex items-center gap-1.5 text-sm font-medium text-white/40 hover:text-white/80 transition-colors pe-4 me-1 py-4 border-e border-hairline"
                                >
                                    <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M15 8C15 8.55228 14.5523 9 14 9L1.91421 9L7.20711 14.2929C7.59763 14.6834 7.59763 15.3166 7.20711 15.7071C6.81658 16.0976 6.18342 16.0976 5.79289 15.7071L-0.0303268 9.88388C-0.518518 9.39573 -0.518518 8.60427 -0.0303268 8.11612L5.79289 0.292893C6.18342 -0.097631 6.81658 -0.097631 7.20711 0.292893C7.59763 0.683417 7.59763 1.31658 7.20711 1.70711L1.91421 7L14 7C14.5523 7 15 7.44772 15 8Z"/>
                                    </svg>
                                    {{ $t('searchContainer.backToCollections') }}
                                </NuxtLink>
                            </li>
                            <CommonTabsItem v-if="!media || hasSearchQuery" data-testid="search-category-tab-all" category="all"
                                :categoryName="media ? t('searchContainer.categoryAll') : animeTabName"
                                :count="media ? unfilteredResultCount : getCategoryCount('all')"
                                :totalCount="getCategoryTotalCount('all')"
                                :isActive="!media && category === 'all'"
                                @click="media ? clearMediaFilter() : categoryFilter('all')" />
                            <CommonTabsItem v-if="media" data-testid="search-category-tab-media" category="media"
                                :categoryName="selectedMediaTabName" :count="getCategoryCount('all')" :isActive="true" />
                            <CommonTabsItem v-if="!media && !isSingleSegmentView && searchData?.categories?.find((item) => item.category === 'ANIME')"
                                data-testid="search-category-tab-anime" category="anime" :categoryName="t('searchContainer.categoryAnime')" :count="getCategoryCount('anime')" :totalCount="getCategoryTotalCount('anime')" :isActive="category === 'anime'"
                                @click="categoryFilter('anime')" />
                            <CommonTabsItem v-if="!media && !isSingleSegmentView && searchData?.categories?.find((item) => item.category === 'JDRAMA')"
                                data-testid="search-category-tab-liveaction" category="liveaction" :categoryName="t('searchContainer.categoryLiveaction')" :count="getCategoryCount('liveaction')" :totalCount="getCategoryTotalCount('liveaction')" :isActive="category === 'liveaction'"
                                @click="categoryFilter('liveaction')" />
                            <CommonTabsItem v-if="!media && !isSingleSegmentView && searchData?.categories?.find((item) => item.category === 'YOUTUBE')"
                                data-testid="search-category-tab-youtube" category="youtube" :categoryName="t('searchContainer.categoryYoutube')" :count="getCategoryCount('youtube')" :totalCount="getCategoryTotalCount('youtube')" :isActive="category === 'youtube'"
                                @click="categoryFilter('youtube')" />
                        </CommonTabsHeader>
                    </CommonTabsContainer>
                </div>
                <div class="shrink-0">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <div v-else-if="statsError" class="sticky top-0 z-30 bg-background pb-3 yomitan-ignore" data-testid="search-stats-error">
            <div class="flex items-center gap-3 border-b border-b-line-subtle py-4 px-4 md:px-0">
                <p class="text-sm text-red-400">{{ $t('searchContainer.errorMessage1') }}</p>
                <button
                    type="button"
                    class="py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                    @click="loadStats()"
                >
                    {{ $t('searchContainer.retryButton') }}
                </button>
                <div class="shrink-0 ml-auto">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <div v-else-if="isLoading && !searchData?.results?.length || !searchData" class="w-full pb-4  animate-pulse yomitan-ignore">
            <CommonTabsContainer>
                <CommonTabsHeader>
                    <div v-for="i in 3" :key="i" class="flex  flex-row space-x-10 gap-10 py-5">
                        <p class="p-2 bg-gray-200 rounded-lg mr-6 dark:bg-neutral-700 px-16"></p>
                    </div>
                </CommonTabsHeader>
            </CommonTabsContainer>
        </div>
        <div v-else class="sticky top-0 z-30 bg-background pb-3 yomitan-ignore">
            <div class="flex items-center gap-3 border-b border-b-line-subtle py-4 px-4 md:px-0">
                <NuxtLink
                    v-if="collectionId"
                    :to="localePath('/user/collections')"
                    class="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-white/40 hover:text-white/80 transition-colors pr-4 py-4 border-r border-hairline"
                >
                    <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M15 8C15 8.55228 14.5523 9 14 9L1.91421 9L7.20711 14.2929C7.59763 14.6834 7.59763 15.3166 7.20711 15.7071C6.81658 16.0976 6.18342 16.0976 5.79289 15.7071L-0.0303268 9.88388C-0.518518 9.39573 -0.518518 8.60427 -0.0303268 8.11612L5.79289 0.292893C6.18342 -0.097631 6.81658 -0.097631 7.20711 0.292893C7.59763 0.683417 7.59763 1.31658 7.20711 1.70711L1.91421 7L14 7C14.5523 7 15 7.44772 15 8Z"/>
                    </svg>
                    {{ $t('searchContainer.backToCollections') }}
                </NuxtLink>
                <span v-if="collectionId && collectionName" class="text-white/70 font-medium text-sm truncate max-w-[20rem]">{{ collectionName }}</span>
                <div class="shrink-0 ml-auto">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <!-- Below the tabs so the title card can leave without the search bar
             and tabs changing their place on the screen. Inset on small screens
             to match the search box; the page column is full-bleed below `md`. -->
        <div class="px-4 md:px-0">
            <slot name="below-tabs" />
        </div>
        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <!-- Above the results rather than in the sticky header: the header's
                     height is a fixed `--search-controls-height` that the sidebar
                     offsets itself by, and this line is a notice to read once, not a
                     control to keep reachable. -->
                <SearchHiddenResultsNotice
                    v-if="hiddenNoticeOffered || revealHidden"
                    :count="hiddenResultCount"
                    :revealed="revealHidden"
                    :breakdown="hiddenBreakdown"
                    :breakdownLoading="hiddenBreakdownLoading"
                    :breakdownError="hiddenBreakdownError"
                    @reveal="setRevealHidden(true)"
                    @restore="setRevealHidden(false)"
                    @breakdown="loadHiddenBreakdown()"
                    @manage="posthog?.capture('hidden_results_manage_clicked', { hidden_count: hiddenResultCount, query })" />
                <SearchSegmentContainer :searchData="searchData" :isLoading="isLoading" :collectionId="collectionId" @remove-from-collection="handleRemoveFromCollection" />
                <CommonInfiniteScrollObserver @intersect="loadSentences({ append: true })" v-if="hasMoreResults && !isLoading" />
                <div v-if="showLoadMoreButton" class="text-center mt-4 mb-8 yomitan-ignore">
                    <UiButtonPrimaryAction class="my-1" @click="loadMore">
                        <UiBaseIcon :path="mdiRefresh" />
                        {{ $t('searchContainer.loadMore') }}
                    </UiButtonPrimaryAction>
                </div>
                <div v-if="endOfResults && !hasMoreResults && searchData?.results?.length > 0" class="text-center mt-4 mb-8 yomitan-ignore">
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                        {{ $t('searchContainer.endOfResults') }}
                    </p>
                </div>
            </div>
            <!-- Filters -->
            <div v-if="!isSingleSentenceView && (searchData?.media?.length > 0 || isLoading)" class="2xl:ml-6 2xl:min-w-[20rem] 2xl:max-w-[20rem] 3xl:min-w-[20rem] 3xl:max-w-[22rem] yomitan-ignore">
                <!-- A cap rather than a fixed height (see `syncSidebarHeight`):
                     a short media list shrinks to its rows, and only a long one
                     grows to the remaining viewport and scrolls inside. -->
                <div
                  v-if="searchData?.media?.length > 0"
                  ref="sidebarRef"
                  class="w-full hidden 2xl:grid 2xl:grid-rows-[minmax(0,1fr)] 2xl:sticky 2xl:top-[var(--search-controls-height)] 2xl:max-h-[calc(100dvh-var(--search-controls-height))] 2xl:overflow-hidden"
                  :style="sidebarMaxHeight ? { maxHeight: sidebarMaxHeight } : undefined"
                >
                    <!-- Titles and episodes are one panel: the filter drills from a
                         title into its episodes rather than stacking two lists.
                         Sort sits above that card as its own button. -->
                    <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" :activeMediaId="media">
                      <template #before>
                        <SearchSegmentFilterSortContent />
                      </template>
                    </SearchSegmentFilterContent>
                </div>
                <div v-else-if="isLoading && !searchData?.results?.length || !searchData">
                    <div class="pl-4 mx-auto hidden 2xl:block min-w-[340px]">
                        <div role=" status" class="hidden w-10/12 2xl:flex flex-col py-6 animate-pulse">
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[460px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[330px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <span class="sr-only">{{ $t('searchContainer.loading') }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
