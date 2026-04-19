<script setup lang="ts">
import { mdiClose, mdiMagnify } from '@mdi/js';

import type { MediaSummary } from '@brigadasos/nadeshiko-sdk';
import type { HiddenMediaItem } from '~/composables/useHiddenMedia';

type NamedMedia = {
  publicId?: string;
  mediaPublicId?: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

const { t, locale } = useI18n();
const sdk = useNadeshikoSdk();
const { mediaName, language } = useMediaName();
const { items: hiddenItems, toggleHideMedia, isMediaHidden } = useHiddenMedia();

const hiddenMediaSearchQuery = ref('');
const hiddenMediaSearchResults = ref<MediaSummary[]>([]);
const searchLoading = ref(false);
let hiddenMediaSearchTimeout: ReturnType<typeof setTimeout> | null = null;

const SEARCH_MAX_RESULTS = 25;

const toMediaNameArgs = (media: NamedMedia) => ({
  nameEn: media.nameEn || '',
  nameJa: media.nameJa || '',
  nameRomaji: media.nameRomaji || '',
});

const displayMediaName = (media: NamedMedia): string => {
  const preferred = mediaName(toMediaNameArgs(media));
  if (preferred) {
    return preferred;
  }
  return t('accountSettings.account.hiddenMediaFallback', { id: media.publicId ?? media.mediaPublicId ?? '-' });
};

const secondaryMediaNames = (media: NamedMedia): string => {
  const namesByLanguage = {
    ENGLISH: media.nameEn || '',
    JAPANESE: media.nameJa || '',
    ROMAJI: media.nameRomaji || '',
  };

  const orderedLanguages: Array<'ENGLISH' | 'JAPANESE' | 'ROMAJI'> = ['ENGLISH', 'JAPANESE', 'ROMAJI'];
  const secondaryNames = orderedLanguages
    .filter((lang) => lang !== language.value)
    .map((lang) => namesByLanguage[lang])
    .filter(Boolean);

  return secondaryNames.join(' | ');
};

const hiddenMediaItems = computed(() =>
  [...hiddenItems.value].sort((a, b) => Date.parse(b.hiddenAt || '') - Date.parse(a.hiddenAt || '')),
);

const formatNumber = (value: number) => new Intl.NumberFormat(locale.value).format(value);

const searchMediaToHide = (query: string) => {
  if (hiddenMediaSearchTimeout) {
    clearTimeout(hiddenMediaSearchTimeout);
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    hiddenMediaSearchResults.value = [];
    return;
  }

  hiddenMediaSearchTimeout = setTimeout(() => {
    void (async () => {
      searchLoading.value = true;
      try {
        const response = await sdk.searchMedia({ query: trimmedQuery, take: SEARCH_MAX_RESULTS });
        hiddenMediaSearchResults.value = response.media;
      } catch {
        hiddenMediaSearchResults.value = [];
      } finally {
        searchLoading.value = false;
      }
    })();
  }, 120);
};

watch(hiddenMediaSearchQuery, searchMediaToHide);

onBeforeUnmount(() => {
  if (hiddenMediaSearchTimeout) {
    clearTimeout(hiddenMediaSearchTimeout);
  }
});

const posthog = usePostHog();

const toggleFromResult = async (result: MediaSummary) => {
  const wasHidden = isMediaHidden(result.publicId);
  await toggleHideMedia({
    publicId: result.publicId,
    nameEn: result.nameEn,
    nameJa: result.nameJa,
    nameRomaji: result.nameRomaji,
  });
  posthog?.capture('media_visibility_changed', {
    action: wasHidden ? 'unhidden' : 'hidden',
    media_name: displayMediaName(result),
  });
};

const unhide = async (item: HiddenMediaItem) => {
  await toggleHideMedia({
    publicId: item.mediaPublicId,
    nameEn: item.nameEn,
    nameJa: item.nameJa,
    nameRomaji: item.nameRomaji,
  });
  posthog?.capture('media_visibility_changed', {
    action: 'unhidden',
    media_name: displayMediaName(item),
  });
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mb-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.account.hiddenMedia') }}</h3>
    <p class="text-gray-400 text-sm mt-1">{{ t('accountSettings.account.hiddenMediaDescription') }}</p>

    <div class="border-b pt-4 border-white/10" />

    <div class="relative mt-4">
      <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
        <UiBaseIcon :path="mdiMagnify" class="text-gray-400" w="w-4" h="h-4" />
      </div>
      <input
        v-model="hiddenMediaSearchQuery"
        type="text"
        data-testid="hidden-media-search-input"
        :placeholder="t('accountSettings.account.hiddenMediaSearchPlaceholder')"
        class="w-full pl-9 pr-10 py-2 bg-neutral-800 text-white border border-white/10 rounded-lg text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
      />
      <button
        v-if="hiddenMediaSearchQuery"
        class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
        @click="hiddenMediaSearchQuery = ''"
      >
        <UiBaseIcon :path="mdiClose" w="w-4" h="h-4" />
      </button>
    </div>

    <div v-if="hiddenMediaSearchResults.length > 0" class="mt-3 overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.media') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.otherNames') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="result in hiddenMediaSearchResults" :key="result.publicId" data-testid="hidden-media-search-result">
            <td lang="ja" class="py-3 text-sm text-gray-100 max-w-[18rem]">
              <p class="font-medium truncate">{{ displayMediaName(result) }}</p>
            </td>
            <td lang="ja" class="py-3 text-xs text-gray-400 max-w-[24rem]">
              <p class="truncate">{{ secondaryMediaNames(result) || '-' }}</p>
            </td>
            <td class="py-3 text-sm text-right">
              <button
                class="text-sm font-medium py-1 px-3 rounded disabled:opacity-50"
                :class="isMediaHidden(result.publicId) ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30' : 'bg-button-accent-main text-white hover:bg-button-accent-hover'"
                @click="toggleFromResult(result)"
              >
                {{ isMediaHidden(result.publicId) ? t('searchpage.main.buttons.unhideMedia') : t('searchpage.main.buttons.hideMedia') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="hiddenMediaSearchQuery.trim().length > 0 && !searchLoading" class="mt-3 text-sm text-gray-400">
      {{ t('accountSettings.account.hiddenMediaNoResults') }}
    </p>
  </div>

  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.account.hiddenMediaListTitle') }}</h3>
      <p class="text-sm text-gray-400">{{ t('accountSettings.account.hiddenMediaCount', { count: formatNumber(hiddenMediaItems.length) }) }}</p>
    </div>

    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4 overflow-x-auto">
      <table v-if="hiddenMediaItems.length > 0" class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.media') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.otherNames') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="item in hiddenMediaItems" :key="item.mediaPublicId" data-testid="hidden-media-item">
            <td lang="ja" class="py-3 text-sm text-gray-100 max-w-[20rem]">
              <p class="font-medium truncate">{{ displayMediaName(item) }}</p>
            </td>
            <td lang="ja" class="py-3 text-xs text-gray-400 max-w-[24rem]">
              <p class="truncate">{{ secondaryMediaNames(item) || '-' }}</p>
            </td>
            <td class="py-3 text-sm text-right">
              <button
                class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-1 px-3 rounded"
                @click="unhide(item)"
              >
                {{ t('searchpage.main.buttons.unhideMedia') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="text-gray-400 text-sm">{{ t('accountSettings.account.hiddenMediaEmpty') }}</p>
    </div>
  </div>
</template>
