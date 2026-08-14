<script setup lang="ts">
import type { FamiliarMediaEntry } from '~/composables/useFamiliarMedia';

defineProps<{
  trackingEnabled: boolean;
  toggling: boolean;
  clearing: boolean;
  familiarEnabled: boolean;
  togglingFamiliar: boolean;
  clearingFamiliar: boolean;
  familiarEntries: FamiliarMediaEntry[];
}>();

const emit = defineEmits<{
  'toggle-tracking': [];
  'clear-history': [];
  'toggle-familiar': [];
  'clear-familiar': [];
  'forget-familiar': [mediaPublicId: string];
}>();

const { t } = useI18n();
const { mediaName } = useMediaName();

/**
 * The row currently being forgotten, so only its own button goes quiet. A single
 * `forgetting` boolean would disable the whole list on one click.
 */
const forgettingId = ref<string | null>(null);

const onForget = (entry: FamiliarMediaEntry) => {
  forgettingId.value = entry.media.publicId;
  emit('forget-familiar', entry.media.publicId);
};

/**
 * "6 cards · 40 plays · 2 shares", with each number pluralised on its own.
 *
 * Three counts cannot share one plural choice, which is why this is composed
 * rather than a single interpolated string -- that read "1 cards" and "0 shares".
 * The separator stays in the locale file so Japanese can use its own.
 */
const familiarCounts = (entry: FamiliarMediaEntry): string =>
  t('accountSettings.activity.privacy.familiarCounts', {
    cards: t('accountSettings.activity.privacy.familiarCards', entry.ankiCount),
    plays: t('accountSettings.activity.privacy.familiarPlays', entry.playCount),
    shares: t('accountSettings.activity.privacy.familiarShares', entry.shareCount),
  });

const displayMediaName = (entry: FamiliarMediaEntry): string =>
  mediaName({
    nameEn: entry.media.nameEn || '',
    nameJa: entry.media.nameJa || '',
    nameRomaji: entry.media.nameRomaji || '',
  }) || entry.media.publicId;
</script>

<template>
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.activity.privacy.title') }}</h3>

    <div class="mt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.trackingTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.trackingDescription') }}</p>
        </div>
        <button
          data-testid="activity-tracking-toggle"
          :disabled="toggling"
          :aria-pressed="trackingEnabled"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            trackingEnabled ? 'bg-red-500' : 'bg-gray-600',
          ]"
          @click="emit('toggle-tracking')"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              trackingEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.clearHistoryTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.clearHistoryDescription') }}</p>
        </div>
        <button
          data-testid="activity-history-clear"
          class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-1.5 px-3 rounded disabled:opacity-50"
          :disabled="clearing"
          @click="emit('clear-history')"
        >
          {{ clearing ? t('accountSettings.activity.privacy.clearing') : t('accountSettings.activity.privacy.clearHistoryButton') }}
        </button>
      </div>

      <div class="border-b border-white/10" />

      <!-- Its own switch, beside the history one rather than under it: this
           stores a monthly count per title, the other a log of what you searched
           and when. Turning either off leaves the other running, and each is
           described by what it keeps so that is not a surprise. -->
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.familiarTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.familiarDescription') }}</p>
        </div>
        <button
          data-testid="familiar-media-toggle"
          :disabled="togglingFamiliar"
          :aria-pressed="familiarEnabled"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            familiarEnabled ? 'bg-red-500' : 'bg-gray-600',
          ]"
          @click="emit('toggle-familiar')"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              familiarEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.clearFamiliarTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.clearFamiliarDescription') }}</p>
        </div>
        <button
          data-testid="familiar-media-clear"
          class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-1.5 px-3 rounded disabled:opacity-50"
          :disabled="clearingFamiliar"
          @click="emit('clear-familiar')"
        >
          {{ clearingFamiliar ? t('accountSettings.activity.privacy.clearing') : t('accountSettings.activity.privacy.clearFamiliarButton') }}
        </button>
      </div>

      <!-- Everything the tally holds, shown plainly. A switch that says "we
           remember what you study" is only honest if you can see what it
           remembered. -->
      <div>
        <p class="text-white/90 text-sm font-medium">{{ t('accountSettings.activity.privacy.familiarListTitle') }}</p>
        <ul v-if="familiarEntries.length > 0" class="mt-2 space-y-1" data-testid="familiar-media-list">
          <li
            v-for="entry in familiarEntries"
            :key="entry.media.publicId"
            class="flex items-center justify-between gap-4 text-sm"
          >
            <span lang="ja" class="text-gray-100 truncate">{{ displayMediaName(entry) }}</span>
            <span class="ml-auto text-gray-400 text-xs shrink-0">
              {{ familiarCounts(entry) }}
            </span>
            <!-- Per title, beside the whole-tally Forget above: a reader who
                 finds one wrong show in the list should not have to throw the
                 rest away to be rid of it. -->
            <button
              type="button"
              class="shrink-0 text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
              :disabled="forgettingId === entry.media.publicId"
              :title="t('accountSettings.activity.privacy.forgetTitleHint', { title: displayMediaName(entry) })"
              :aria-label="t('accountSettings.activity.privacy.forgetTitleHint', { title: displayMediaName(entry) })"
              :data-testid="`familiar-media-forget-${entry.media.publicId}`"
              @click="onForget(entry)"
            >
              {{ t('accountSettings.activity.privacy.forgetTitle') }}
            </button>
          </li>
        </ul>
        <p v-else class="mt-2 text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.familiarListEmpty') }}</p>
      </div>
    </div>
  </div>
</template>
