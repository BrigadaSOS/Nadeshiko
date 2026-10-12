<script setup lang="ts">
import { mdiClose, mdiEye, mdiEyeOff, mdiMagnify, mdiStar, mdiStarOutline } from '@mdi/js';
import { MAX_FAVORITE_MEDIA } from '~/composables/useFavoriteMedia';
import { type MarkedMedia, mergeMarkedMedia } from '~/utils/manageMediaList';
import { useToastSuccess } from '~/utils/toast';
import { handleApiError } from '~/utils/apiError';

/** One row exposes favorite and hide controls for both marked titles and catalogue search results. */
const { t } = useI18n();
const { formatNumber } = useFormat();
const { displayMediaName, secondaryMediaNames } = useMediaDisplayName();
const { query, results, loading, failed } = useMediaSearch('media-lookup:search-failed');
const { items: favoriteItems, toggleFavorite, isFavorite, atCap } = useFavoriteMedia();
const { hiddenMediaIds, toggleHideMedia, isMediaHidden } = useHiddenMedia();
const posthog = usePostHog();

const isSearching = computed(() => query.value.trim().length > 0);

/** Resolve id-only preferences through list endpoints; new search selections already carry names and need no
 * extra lookup.
 */
const resolvedNames = ref(new Map<string, MarkedMedia>());
const resolveFailed = ref(false);

const rememberName = (media: MarkedMedia) => {
  resolvedNames.value = new Map(resolvedNames.value).set(media.publicId, media);
};

/**
 * Client-side on purpose. Resolving during SSR would fold every marked title's
 * names back into `__NUXT_DATA__` -- the exact payload taking them out of
 * preferences was meant to shrink -- and on one settings tab, not every page.
 */
onMounted(async () => {
  const sdk = useNadeshikoSdk();
  try {
    const [favorites, excluded] = await Promise.all([sdk.listFavoriteMedia(), sdk.listExcludedMedia()]);
    const next = new Map(resolvedNames.value);
    for (const media of [...favorites.favoriteMedia, ...excluded.excludedMedia]) {
      next.set(media.publicId, {
        publicId: media.publicId,
        nameEn: media.nameEn,
        nameJa: media.nameJa,
        nameRomaji: media.nameRomaji,
      });
    }
    resolvedNames.value = next;
  } catch (error) {
    // The rows still render, from their ids, and both controls still work --
    // so the notice explains the ids rather than replacing the table with an
    // error the reader cannot act on.
    resolveFailed.value = true;
    handleApiError('manage-media:resolve-failed', error, { toastKey: false });
  }
});

/** Newest first, the order `/v1/user/favorite-media` returns and a reload restores. */
const favoriteIdsNewestFirst = computed<string[]>(() =>
  [...favoriteItems.value]
    .sort((a, b) => (b.favoritedAt ?? '').localeCompare(a.favoritedAt ?? ''))
    .map((item) => item.mediaPublicId),
);

/** What the reader has marked. See `mergeMarkedMedia`. */
const markedMedia = computed<MarkedMedia[]>(() =>
  mergeMarkedMedia(favoriteIdsNewestFirst.value, hiddenMediaIds.value, resolvedNames.value),
);

const rows = computed<MarkedMedia[]>(() =>
  isSearching.value
    ? results.value.map((result) => ({
        publicId: result.publicId,
        nameEn: result.nameEn,
        nameJa: result.nameJa,
        nameRomaji: result.nameRomaji,
      }))
    : markedMedia.value,
);

/** Confirm changes by title only after they are stored; failed toggles already toast and roll back the row. */
const onToggleFavorite = async (media: MarkedMedia) => {
  const wasFavorite = isFavorite(media.publicId);
  rememberName(media);
  const saved = await toggleFavorite({
    publicId: media.publicId,
    nameEn: media.nameEn,
    nameJa: media.nameJa,
    nameRomaji: media.nameRomaji,
  });
  if (!saved) return;

  useToastSuccess(
    t(wasFavorite ? 'accountSettings.account.mediaUnfavoritedToast' : 'accountSettings.account.mediaFavoritedToast', {
      name: displayMediaName(media),
    }),
  );
};

const onToggleHidden = async (media: MarkedMedia) => {
  const wasHidden = isMediaHidden(media.publicId);
  rememberName(media);
  const saved = await toggleHideMedia({
    publicId: media.publicId,
    nameEn: media.nameEn,
    nameJa: media.nameJa,
    nameRomaji: media.nameRomaji,
  });
  if (!saved) return;

  posthog?.capture('media_visibility_changed', {
    action: wasHidden ? 'unhidden' : 'hidden',
    media_name: displayMediaName(media),
  });
  useToastSuccess(
    t(wasHidden ? 'accountSettings.account.mediaUnhiddenToast' : 'accountSettings.account.mediaHiddenToast', {
      name: displayMediaName(media),
    }),
  );
};
</script>

<template>
  <div class="nd-settings-card">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="nd-settings-title">{{ t('accountSettings.account.manageMedia') }}</h3>
      <p class="text-sm text-gray-400">
        {{ t('accountSettings.account.favoriteMediaCount', { count: formatNumber(favoriteItems.length), max: formatNumber(MAX_FAVORITE_MEDIA) }) }}
        &middot;
        {{ t('accountSettings.account.hiddenMediaCount', { count: formatNumber(hiddenMediaIds.length) }) }}
      </p>
    </div>
    <p class="text-gray-400 text-sm mt-1">{{ t('accountSettings.account.manageMediaDescription') }}</p>

    <div class="relative mt-4">
      <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
        <UiBaseIcon :path="mdiMagnify" class="text-gray-400" w="w-4" h="h-4" />
      </div>
      <input
        v-model="query"
        type="text"
        data-testid="media-lookup-search-input"
        :placeholder="t('accountSettings.account.mediaLookupPlaceholder')"
        class="nd-input pl-9 pr-10"
      />
      <button type="button"
        v-if="query"
        class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
        @click="query = ''"
      >
        <UiBaseIcon :path="mdiClose" w="w-4" h="h-4" />
      </button>
    </div>

    <p v-if="atCap" class="mt-3 text-sm text-amber-300" data-testid="favorite-media-cap-notice">
      {{ t('favoriteMedia.capReached') }}
    </p>

    <p v-if="resolveFailed && !isSearching" class="mt-3 text-sm text-red-400" data-testid="managed-media-names-error">
      {{ t('errors.generic') }}
    </p>

    <!-- Below `md` the title and its other names stack, with the two controls
         pinned to the right of the title. Both name columns truncate, so shared
         between them a phone's width leaves neither readable. -->
    <div v-if="rows.length > 0" class="mt-3 md:overflow-x-auto">
      <table class="block w-full md:table md:min-w-full md:divide-y md:divide-gray-200 md:dark:divide-white/20">
        <thead class="hidden md:table-header-group">
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.media') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.hiddenMediaTable.otherNames') }}</th>
            <th class="py-2 text-right text-xs font-medium text-white/90 uppercase">{{ t('accountSettings.account.manageMediaTableActions') }}</th>
          </tr>
        </thead>
        <tbody class="block md:table-row-group md:divide-y md:divide-gray-200 md:dark:divide-white/10">
          <tr
            v-for="media in rows"
            :key="media.publicId"
            :data-testid="isSearching ? 'media-lookup-result' : 'managed-media-item'"
            :data-favorite="isFavorite(media.publicId) ? 'true' : 'false'"
            :data-hidden="isMediaHidden(media.publicId) ? 'true' : 'false'"
            class="flex flex-wrap items-center gap-x-3 border-b border-white/10 py-3 last:border-0 md:table-row md:border-0 md:py-0"
          >
            <td lang="ja" class="order-1 min-w-0 flex-1 text-sm text-gray-100 md:flex-none md:table-cell md:py-3 md:max-w-[18rem]">
              <p class="font-medium truncate">{{ displayMediaName(media) }}</p>
            </td>
            <td lang="ja" class="order-3 w-full min-w-0 text-xs text-gray-400 md:order-none md:w-auto md:table-cell md:py-3 md:max-w-[24rem]">
              <p class="truncate">{{ secondaryMediaNames(media) || '-' }}</p>
            </td>
            <td class="order-2 text-sm whitespace-nowrap md:table-cell md:py-3">
              <!-- 44px targets, 8px apart. This is a settings table with room to
                   spare, and both controls are icon-only, so the tap area is all
                   there is to aim at; the gap keeps two adjacent targets from
                   overlapping into each other. -->
              <div class="flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-testid="media-lookup-favorite"
                  :aria-label="isFavorite(media.publicId) ? t('searchpage.main.buttons.unfavoriteMedia') : t('searchpage.main.buttons.favoriteMedia')"
                  :aria-pressed="isFavorite(media.publicId)"
                  :disabled="atCap && !isFavorite(media.publicId)"
                  :title="atCap && !isFavorite(media.publicId) ? t('favoriteMedia.capReached') : undefined"
                  class="inline-flex items-center justify-center min-w-11 min-h-11 rounded hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
                  @click="onToggleFavorite(media)"
                >
                  <UiBaseIcon
                    :path="isFavorite(media.publicId) ? mdiStar : mdiStarOutline"
                    w="w-5" h="h-5"
                    :class="isFavorite(media.publicId) ? 'text-yellow-400' : 'text-white/40'"
                  />
                </button>
                <button
                  type="button"
                  data-testid="media-lookup-hide"
                  :aria-label="isMediaHidden(media.publicId) ? t('searchpage.main.buttons.unhideMedia') : t('searchpage.main.buttons.hideMedia')"
                  :aria-pressed="isMediaHidden(media.publicId)"
                  class="inline-flex items-center justify-center min-w-11 min-h-11 rounded hover:bg-white/10"
                  @click="onToggleHidden(media)"
                >
                  <UiBaseIcon
                    :path="isMediaHidden(media.publicId) ? mdiEyeOff : mdiEye"
                    w="w-5" h="h-5"
                    :class="isMediaHidden(media.publicId) ? 'text-red-300' : 'text-white/40'"
                  />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="failed && !loading" class="mt-3 text-sm text-red-400" data-testid="media-lookup-search-error">
      {{ t('errors.generic') }}
    </p>
    <p v-else-if="isSearching && !loading" class="mt-3 text-sm text-gray-400">
      {{ t('accountSettings.account.mediaLookupNoResults') }}
    </p>
    <p v-else-if="!isSearching" class="mt-3 text-sm text-gray-400">
      {{ t('accountSettings.account.manageMediaEmpty') }}
    </p>
  </div>
</template>
