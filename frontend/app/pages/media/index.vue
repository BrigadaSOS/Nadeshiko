<script setup lang="ts">
import { mdiGrid, mdiFormatListBulletedSquare, mdiArrowRight, mdiPencilOutline, mdiEyeOff } from '@mdi/js';
import { useTimeoutFn } from '@vueuse/core';
import type { Category, Media } from '@brigadasos/nadeshiko-sdk';
import { userStore } from '@/stores/auth';
import { handleApiError } from '~/utils/apiError';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';
import { reportError } from '~/utils/reportError';
import { mediaBrowsePath } from '~/utils/routes';

const { t } = useI18n();

useSeoMeta({
  title: () => t('seo.media.title'),
  ogTitle: () => t('seo.media.title'),
  description: () => t('seo.media.description'),
  ogDescription: () => t('seo.media.description'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => t('seo.media.title'),
  twitterDescription: () => t('seo.media.description'),
});

const sdk = useNadeshikoSdk();
const router = useRouter();
const route = useRoute();
const localePath = useLocalePath();

useSchemaOrg([
  defineWebPage({ '@type': 'CollectionPage' }),
  defineBreadcrumb({
    itemListElement: [
      { name: t('navbar.buttons.home'), item: localePath('/') },
      { name: t('seo.media.title'), item: localePath('/media') },
    ],
  }),
]);

const { scrollToTop } = useQuerySync();
const { mediaName, language } = useMediaName();
const { hiddenMediaIds } = useHiddenMedia();
const { isCategoryHidden, hasHiddenCategories } = useHiddenCategories();
const user = userStore();

const mediaToEdit = ref<Media | null>(null);

const openEditModal = (mediaInfo: Media) => {
  mediaToEdit.value = mediaInfo;
};

const onEditSuccess = (updatedMedia: Media | null) => {
  if (!updatedMedia) return;
  const index = media.value.findIndex((m) => m.publicId === updatedMedia.publicId);
  const current = media.value[index];
  if (current) {
    media.value[index] = { ...current, ...updatedMedia };
  }
};

const onDeleteSuccess = (mediaPublicId: string) => {
  media.value = media.value.filter((m) => m.publicId !== mediaPublicId);
};

const secondaryMediaNames = (mediaInfo: Media) => {
  const namesByLanguage: Record<string, string> = {
    ENGLISH: mediaInfo?.nameEn || '',
    JAPANESE: mediaInfo?.nameJa || '',
    ROMAJI: mediaInfo?.nameRomaji || '',
  };

  const order = ['ENGLISH', 'JAPANESE', 'ROMAJI'];
  const secondary = order
    .filter((lang) => lang !== language.value)
    .map((lang) => namesByLanguage[lang])
    .filter(Boolean);

  return secondary.join(' - ');
};

const allowedFilterTypes = new Set<string>(['ANIME', 'JDRAMA', 'YOUTUBE']);
const pageSize = 28;

const normalizeView = (value: unknown) => (value === 'list' ? 'list' : 'grid');
const normalizeQuery = (value: unknown) => (typeof value === 'string' ? value : '');
const normalizeCategory = (value: unknown): Category | '' => {
  const category = typeof value === 'string' ? value : '';
  return allowedFilterTypes.has(category) ? (category as Category) : '';
};

const currentView = computed(() => normalizeView(route.query.view));
const searchQuery = computed(() => normalizeQuery(route.query.query));
const filterCategory = computed(() => normalizeCategory(route.query.category));

type MediaBrowseParams = {
  view?: unknown;
  query?: unknown;
  category?: unknown;
};

const buildQueryParams = (params: MediaBrowseParams = {}) => {
  const nextView = normalizeView(params.view ?? currentView.value);
  const nextQuery = normalizeQuery(params.query ?? searchQuery.value);
  const nextCategory = normalizeCategory(params.category ?? filterCategory.value);

  return {
    view: nextView,
    query: nextQuery || undefined,
    category: nextCategory || undefined,
  };
};

const updateUrl = async (params: MediaBrowseParams = {}) => {
  const nextQuery = buildQueryParams(params);
  await router.push({ query: nextQuery });
};

const media = ref<Media[]>([]);
const { hasMore, loadingMore, loadMore: fetchNextPage, seed: seedPagination } = useCursorPagination();

const {
  data: initialResponse,
  pending,
  error,
  refresh,
} = await useAsyncData(
  () => `search-media-${searchQuery.value}-${filterCategory.value}`,
  async () => {
    const raw = await sdk.listMedia({
      query: searchQuery.value || undefined,
      take: pageSize,
      category: filterCategory.value || undefined,
    });
    return {
      media: raw?.media ?? [],
      hasMore: raw?.pagination?.hasMore ?? false,
      cursor: raw?.pagination?.cursor ?? null,
    };
  },
  {
    watch: [searchQuery, filterCategory],
    server: true,
    lazy: false,
    default: () => ({
      media: [] as Media[],
      hasMore: false,
      cursor: null as string | null,
    }),
  },
);

const syncFromResponse = () => {
  media.value = initialResponse.value?.media ?? [];
  seedPagination(initialResponse.value);
};

syncFromResponse();

if (import.meta.client) {
  const posthog = usePostHog();
  posthog?.capture('media_browsed', {
    category: filterCategory.value,
    search_query: searchQuery.value,
  });
}

watch(initialResponse, () => {
  syncFromResponse();
});

const showHidden = ref(false);

const filteredMedia = computed(() => {
  if (showHidden.value) return media.value;

  const hidden = new Set(hiddenMediaIds.value);
  // Picking a category from the dropdown is an explicit request for it, so it
  // survives being hidden -- the same override `?category=` gets on search.
  const dropsCategories = hasHiddenCategories.value && !filterCategory.value;
  if (hidden.size === 0 && !dropsCategories) return media.value;

  return media.value.filter(
    (m) => !hidden.has(m.publicId) && !(dropsCategories && m.category && isCategoryHidden(m.category)),
  );
});

const hasHiddenMedia = computed(() => hiddenMediaIds.value.length > 0);
const hasHiddenContent = computed(() => hasHiddenMedia.value || hasHiddenCategories.value);

const loading = computed(() => pending.value);
const query = ref(searchQuery.value);

watch(searchQuery, (value) => {
  if (value !== query.value) {
    query.value = value;
  }
});

// Cancelled on unmount by `useTimeoutFn`: a pending push landing after the
// reader has left would navigate them back to this page.
const { start: scheduleUrlUpdate } = useTimeoutFn(
  (value: string) => {
    updateUrl({ query: value.trim() });
  },
  300,
  { immediate: false },
);

watch(query, (value) => {
  if (value === searchQuery.value) {
    return;
  }

  scheduleUrlUpdate(value);
});

watch(error, (fetchError) => {
  if (fetchError) {
    reportError('media:list-fetch-failed', fetchError);
  }
});

const setGridView = () => {
  updateUrl({ view: 'grid' });
};

const setListView = () => {
  updateUrl({ view: 'list' });
};

const loadMore = async () => {
  const outcome = await fetchNextPage(async (cursor) => {
    try {
      const raw = await sdk.listMedia({
        cursor: cursor ?? undefined,
        query: searchQuery.value || undefined,
        take: pageSize,
        category: filterCategory.value || undefined,
      });
      return {
        media: raw?.media ?? [],
        hasMore: raw?.pagination?.hasMore ?? false,
        cursor: raw?.pagination?.cursor ?? null,
      };
    } catch (error) {
      // Infinite scroll: the sentinel just stops producing rows, so without a toast
      // the page reads as "that's everything" when the next page actually failed.
      handleApiError('media:load-more-failed', error, { toastKey: 'mediaBrowse.loadMoreError' });
      return null;
    }
  });

  if (outcome.status !== 'ok') return;
  media.value = [...media.value, ...outcome.page.media];
};

const handleFilterChange = (category: string) => {
  updateUrl({ category });
};

const trackMediaSelected = (mediaInfo: Media, viewMode: string) => {
  const posthog = usePostHog();
  posthog?.capture('media_selected', {
    media_id: mediaInfo.publicId,
    media_name: mediaName(mediaInfo),
    view_mode: viewMode,
  });
};

const onSentinelVisible = () => {
  if (hasMore.value && !loadingMore.value && !loading.value) {
    loadMore();
  }
};

watch([searchQuery, filterCategory], () => {
  scrollToTop();
});
</script>

<template>
  <div class="nd-page min-h-screen px-4 md:px-0 py-6">
      <div class="inline-flex justify-between items-center w-full mb-3">
        <h1 class="text-[2.5rem] font-extrabold dark:text-white pl-4 leading-tight relative before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:bg-button-accent-main before:rounded-sm">
          {{ $t('animeList.fullListTitle') }}
        </h1>
      </div>
      <input
        v-model="query"
        data-testid="media-search-input"
        class="block p-2.5 mb-4 w-full text-sm text-gray-900 rounded-lg border border-gray-300 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 dark:text-white"
        :placeholder="$t('searchpage.main.labels.searchmain')"
      />
      <div class="flex items-center mb-4">
        <SearchDropdownContainer class="" dropdownId="nd-dropdown-with-header">
          <template #default>
            <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
              {{ $t('searchpage.main.labels.searchbar').replace('...', '') }}
            </SearchDropdownMainButton>
          </template>
          <template #content>
            <SearchDropdownContent>
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAll')"
                @click="handleFilterChange('')"
                :selected="filterCategory === ''"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAnime')"
                @click="handleFilterChange('ANIME')"
                :selected="filterCategory === 'ANIME'"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryLiveaction')"
                @click="handleFilterChange('JDRAMA')"
                :selected="filterCategory === 'JDRAMA'"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryYoutube')"
                @click="handleFilterChange('YOUTUBE')"
                :selected="filterCategory === 'YOUTUBE'"
              />
              <div v-if="hasHiddenContent" class="my-1 border-t border-white/10"></div>
              <SearchDropdownItem
                v-if="hasHiddenContent"
                :text="showHidden ? $t('mediaBrowse.hideHiddenMedia') : $t('mediaBrowse.showHiddenMedia')"
                :iconPath="mdiEyeOff"
                @click="showHidden = !showHidden"
                :selected="showHidden"
              />
            </SearchDropdownContent>
          </template>
        </SearchDropdownContainer>
        <div class="ml-auto gap-2 flex">
          <UiButtonPrimaryAction data-testid="grid-view-button" @click="setGridView">
            <UiBaseIcon :path="mdiGrid" />
          </UiButtonPrimaryAction>
          <UiButtonPrimaryAction data-testid="list-view-button" @click="setListView">
            <UiBaseIcon :path="mdiFormatListBulletedSquare" />
          </UiButtonPrimaryAction>
        </div>
      </div>
      <div v-if="error && media.length === 0 && !loading" class="py-12 text-center text-sm" data-testid="media-load-error">
        <p class="text-red-400">{{ t('mediaBrowse.loadError') }}</p>
        <button
          type="button"
          class="mt-3 py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="refresh()"
        >
          {{ t('searchContainer.retryButton') }}
        </button>
      </div>
      <div
        v-else-if="currentView === 'grid'"
        data-testid="media-grid"
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3 md:gap-4 lg:gap-5 xl:gap-6"
      >
        <!-- Loading Placeholder for Grid (initial load) -->
        <div v-if="loading && filteredMedia.length === 0" v-for="i in pageSize" :key="i" class="flex flex-col items-center animate-pulse">
          <div class="relative w-full overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)] aspect-[2/3]"></div>
          <div class="mt-2 w-full h-4  rounded"></div>
        </div>

        <!-- Media Content -->
        <div
          v-if="!loading || filteredMedia.length > 0"
          v-for="(mediaInfo, index) in filteredMedia"
          :key="mediaInfo.publicId"
          data-testid="media-card-container"
          class="flex flex-col items-center"
        >
          <div
            class="relative w-full overflow-hidden rounded-lg shadow-lg transition-all bg-[rgba(255,255,255,0.06)] aspect-[2/3]"
          >
            <NuxtLink
              data-testid="media-card"
              :to="localePath(mediaBrowsePath(mediaInfo))"
              @click="trackMediaSelected(mediaInfo, 'grid')"
            >
              <MediaCover
                :media="mediaInfo"
                :alt="mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'Media cover image'"
              />
            </NuxtLink>
            <button
              v-if="user.isAdmin"
              class="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded bg-neutral-900/70 text-white hover:bg-neutral-900/90 transition-colors"
              @click.stop="openEditModal(mediaInfo)"
            >
              <UiBaseIcon :path="mdiPencilOutline" w="w-4" h="h-4" size="16" />
            </button>
          </div>
          <NuxtLink :to="localePath(mediaBrowsePath(mediaInfo))" class="mt-2 text-center justify-center flex flex-col items-center">
            <h3 lang="ja" data-testid="media-card-title" class="text-sm text-center font-semibold line-clamp-2 dark:text-gray-100">
              {{ mediaName(mediaInfo) }}
            </h3>
          </NuxtLink>
          <div class="text-center mt-1 mb-5 justify-center flex flex-col items-center">
            <h3 class="text-sm text-center font-medium dark:text-gray-300">
              {{ mediaInfo.segmentCount }} {{ $t('animeList.sentenceCount') }}
            </h3>
            <h3 class="text-sm text-center font-medium dark:text-gray-300">
              <MediaCountLabel :media="mediaInfo" />
            </h3>
          </div>
        </div>
      </div>
      <div v-if="currentView === 'list'" class="tab-content">
        <!-- Loading Placeholder for List (initial load) -->
        <div v-if="loading && filteredMedia.length === 0" v-for="i in pageSize" :key="i" class="w-full relative mb-4 animate-pulse">
          <div
            class="relative flex flex-col z-20 items-center sm:items-start sm:flex-row rounded-lg bg-[rgba(255,255,255,0.06)] transition-all"
          >
            <div class="relative flex-none w-[16em] h-[21em] bg-[rgba(255,255,255,0.06)] rounded-lg"></div>

            <div class="relative flex-auto p-6 z-10">
              <div class="h-6 bg-[rgba(255,255,255,0.06)] rounded mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-3/4 mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-1/2 mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-1/4"></div>
            </div>
          </div>
        </div>
        <!-- Media Content -->
        <div
          v-if="filteredMedia.length > 0"
          v-for="(mediaInfo, index) in filteredMedia"
          :key="mediaInfo.publicId"
          data-testid="media-list-item"
          class="w-full relative mb-4"
        >
          <div
            class="relative flex flex-col z-20 items-center sm:items-stretch sm:flex-row rounded-lg dark:bg-card-background transition-all dark:border-white/10 border"
          >
            <div class="absolute inset-0">
              <img
                :src="mediaInfo.bannerUrl"
                :alt="`Banner image for ${mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'media'}`"
                loading="lazy"
                class="object-cover w-full h-full rounded-lg"
              />
              <div
                class="absolute inset-0 bg-card-background opacity-95 rounded-lg"
              ></div>
            </div>
            <div class="relative flex-none w-[16em] h-[21em] overflow-hidden rounded-lg">
              <MediaCover
                :media="mediaInfo"
                :alt="`Cover image for ${mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'media'}`"
              />
            </div>

            <div class="relative flex-auto p-6 z-10 flex flex-col sm:self-stretch">
              <div class="flex flex-wrap">
                <h1 lang="ja" class="flex-auto text-xl font-semibold dark:text-gray-50">
                  {{ mediaName(mediaInfo) }}
                </h1>
                <div
                  class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white"
                >
                  {{ $t('searchContainer.categoryAnime') }}
                </div>
                <div
                  lang="ja"
                  class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300"
                >
                  {{ secondaryMediaNames(mediaInfo) }}
                </div>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="grid grid-cols-1 gap-1">
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.sentenceCountLabel') }} {{ mediaInfo.segmentCount }}
                </p>
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  <MediaCountLabel :media="mediaInfo" label-first />
                </p>
              </div>

              <div class="mt-auto pt-3 flex justify-end items-center flex-wrap gap-3">
                <div class="flex">
                  <button
                    v-if="user.isAdmin"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg dark:border-amber-400/70 dark:text-amber-400"
                    @click.stop="openEditModal(mediaInfo)"
                  >
                    <UiBaseIcon :path="mdiPencilOutline" w="w-5" h="h-5" size="20" />
                    <div>{{ $t('modalMediaEdit.editButton') }}</div>
                  </button>

                  <a
                    v-if="mediaInfo.externalIds?.anilist"
                    :href="`https://anilist.co/anime/${mediaInfo.externalIds.anilist}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-input-focus-ring dark:border-white dark:placeholder-gray-400 dark:text-white"
                  >
                    <div>{{ $t('animeList.anilistButton') }}</div>
                  </a>

                  <a
                    v-if="mediaInfo.externalIds?.youtube"
                    :href="youtubeChannelUrl(mediaInfo.externalIds.youtube)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-input-focus-ring dark:border-white dark:placeholder-gray-400 dark:text-white"
                  >
                    <div>{{ $t('animeList.youtubeButton') }}</div>
                  </a>

                  <NuxtLink
                    :to="localePath(mediaBrowsePath(mediaInfo))"
                    class="py-3.5 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm hover:bg-red-500/10 text-red-600 border-red-500/70 rounded-lg focus:border-input-focus-ring dark:border-red-400 dark:placeholder-gray-400 dark:text-red-400"
                    @click="trackMediaSelected(mediaInfo, 'list')"
                  >
                    <div>{{ $t('animeList.vocabularyButton') }}</div>
                    <UiBaseIcon
                      :path="mdiArrowRight"
                      w="w-5 md:w-5"
                      h="h-5 md:h-5"
                      size="20"
                      class=""
                    />
                  </NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading more indicator -->
      <div v-if="loadingMore" class="flex justify-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
      </div>

      <!-- Infinite scroll sentinel -->
      <CommonInfiniteScrollObserver v-if="hasMore && !loading" root-margin="200px" @intersect="onSentinelVisible" />

      <MediaModalMediaEdit
        v-if="user.isAdmin"
        :media="mediaToEdit"
        @update:success="onEditSuccess"
        @delete:success="onDeleteSuccess"
        @close="mediaToEdit = null"
      />
    </div>
</template>
