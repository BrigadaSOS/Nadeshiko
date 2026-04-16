<script setup lang="ts">
import type { MediaUpdateRequest } from '@brigadasos/nadeshiko-sdk';

const { t } = useI18n();

const props = defineProps<{
  media: {
    id: number;
    publicId: string;
    nameJa: string;
    nameRomaji: string;
    nameEn: string;
    airingFormat: string;
    airingStatus: string;
    category: string;
    genres: string[];
    studio: string;
    startDate: string;
    endDate?: string | null;
    seasonName: string;
    seasonYear: number;
    coverUrl: string;
    bannerUrl?: string;
    externalIds?: { anilist?: string; imdb?: string; tvdb?: string; tmdb?: string };
  } | null;
}>();

const emit = defineEmits<{
  'update:success': [media: typeof props.media];
  'delete:success': [mediaId: number];
}>();

const sdk = useNadeshikoSdk();
const isSubmitting = ref(false);
const isDeleting = ref(false);
const showDeleteConfirm = ref(false);
const errorMessage = ref('');

const OVERLAY_ID = '#nd-vertically-centered-scrollable-media-edit';

const form = reactive({
  nameJa: '',
  nameRomaji: '',
  nameEn: '',
  airingFormat: '',
  airingStatus: '',
  category: 'ANIME' as 'ANIME' | 'JDRAMA',
  genres: '',
  studio: '',
  startDate: '',
  endDate: '',
  seasonName: '',
  seasonYear: 0,
  anilistId: '',
  imdbId: '',
  tvdbId: '',
  tmdbId: '',
});

const airingFormatOptions = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'] as const;
const airingStatusOptions = ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED'] as const;
const categoryOptions = ['ANIME', 'JDRAMA'] as const;
const seasonOptions = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

const pillClasses = (active: boolean) => {
  const base =
    'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-900 cursor-pointer';
  if (!active)
    return `${base} border border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-300`;
  return `${base} bg-blue-600/80 text-blue-100 border border-blue-500 focus:ring-blue-500`;
};

watch(
  () => props.media,
  (m) => {
    if (!m) return;
    form.nameJa = m.nameJa || '';
    form.nameRomaji = m.nameRomaji || '';
    form.nameEn = m.nameEn || '';
    form.airingFormat = m.airingFormat || '';
    form.airingStatus = m.airingStatus || '';
    form.category = (m.category as 'ANIME' | 'JDRAMA') || 'ANIME';
    form.genres = (m.genres || []).join(', ');
    form.studio = m.studio || '';
    form.startDate = m.startDate || '';
    form.endDate = m.endDate || '';
    form.seasonName = m.seasonName || '';
    form.seasonYear = m.seasonYear || 0;
    form.anilistId = m.externalIds?.anilist || '';
    form.imdbId = m.externalIds?.imdb || '';
    form.tvdbId = m.externalIds?.tvdb || '';
    form.tmdbId = m.externalIds?.tmdb || '';
    errorMessage.value = '';
    showDeleteConfirm.value = false;
  },
);

const closeModal = () => {
  window.NDOverlay?.close(OVERLAY_ID);
};

const submitEdit = async () => {
  if (!props.media || isSubmitting.value) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const body: MediaUpdateRequest = {
      nameJa: form.nameJa,
      nameRomaji: form.nameRomaji,
      nameEn: form.nameEn,
      airingFormat: form.airingFormat,
      airingStatus: form.airingStatus,
      category: form.category as MediaUpdateRequest['category'],
      genres: form.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      studio: form.studio,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      seasonName: form.seasonName,
      seasonYear: form.seasonYear,
    };

    const externalIds: Record<string, string> = {};
    if (form.anilistId) externalIds.anilist = form.anilistId;
    if (form.imdbId) externalIds.imdb = form.imdbId;
    if (form.tvdbId) externalIds.tvdb = form.tvdbId;
    if (form.tmdbId) externalIds.tmdb = form.tmdbId;
    if (Object.keys(externalIds).length > 0) {
      body.externalIds = externalIds;
    }

    await sdk.updateMedia({
      path: { mediaId: props.media.publicId },
      body,
    });

    const updatedMedia = {
      ...props.media,
      nameJa: form.nameJa,
      nameRomaji: form.nameRomaji,
      nameEn: form.nameEn,
      airingFormat: form.airingFormat,
      airingStatus: form.airingStatus,
      category: form.category,
      genres: form.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      studio: form.studio,
      startDate: form.startDate,
      endDate: form.endDate || null,
      seasonName: form.seasonName,
      seasonYear: form.seasonYear,
      externalIds: {
        anilist: form.anilistId || undefined,
        imdb: form.imdbId || undefined,
        tvdb: form.tvdbId || undefined,
      },
    };

    emit('update:success', updatedMedia as any);
    useToastSuccess(t('modalMediaEdit.saveSuccess'));
    closeModal();
  } catch {
    errorMessage.value = t('modalMediaEdit.saveError');
  } finally {
    isSubmitting.value = false;
  }
};

const submitDelete = async () => {
  if (!props.media || isDeleting.value) return;

  isDeleting.value = true;
  errorMessage.value = '';

  try {
    await sdk.deleteMedia({
      path: { mediaId: props.media.publicId },
    });

    emit('delete:success', props.media.id);
    useToastSuccess(t('modalMediaEdit.deleteSuccess'));
    closeModal();
  } catch {
    errorMessage.value = t('modalMediaEdit.deleteError');
  } finally {
    isDeleting.value = false;
    showDeleteConfirm.value = false;
  }
};
</script>

<template>
  <div
    id="nd-vertically-centered-scrollable-media-edit"
    class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/60 hidden w-full h-full flex items-center justify-center fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="w-full max-w-3xl mx-auto flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
    >
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('modalMediaEdit.title') }}
        </h3>
        <button
          type="button"
          class="nd-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
          :data-nd-overlay="OVERLAY_ID"
        >
          <span class="sr-only">{{ t('modalMediaEdit.close') }}</span>
          <svg class="w-3.5 h-3.5" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0.258 1.007a.75.75 0 011.06 0L3.612 3.653 6.258 1.007a.75.75 0 111.06 1.06L4.672 4.36l2.647 2.647a.75.75 0 11-1.06 1.06L3.612 5.42l-2.647 2.646a.75.75 0 11-1.06-1.06L2.553 4.36.258 2.067a.75.75 0 010-1.06z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      <div class="p-4 overflow-y-auto max-h-[70vh] space-y-5">
        <div
          v-if="errorMessage"
          class="p-3 text-sm text-red-400 bg-red-900/20 border border-red-700 rounded-lg"
        >
          {{ errorMessage }}
        </div>

        <div v-if="media" class="rounded-lg bg-neutral-800/50 border border-neutral-700 p-3 text-sm">
          <div class="flex gap-3">
            <img
              v-if="media.coverUrl"
              :src="media.coverUrl"
              class="w-16 h-22 rounded object-cover flex-shrink-0 text-transparent"
              :alt="media.nameRomaji"
            />
            <div class="space-y-2 min-w-0 flex-1">
              <div class="flex items-center gap-2 text-neutral-300">
                <span class="text-neutral-500 min-w-[4.5rem]">ID</span>
                <span class="font-mono text-neutral-300">#{{ media.id }}</span>
              </div>
              <div class="flex items-center gap-2 text-neutral-300">
                <span class="text-neutral-500 min-w-[4.5rem]">Public ID</span>
                <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ media.publicId }}</code>
              </div>
              <div v-if="media.coverUrl" class="flex items-center gap-2 text-neutral-300">
                <span class="text-neutral-500 min-w-[4.5rem]">Cover</span>
                <a :href="media.coverUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ media.coverUrl }}</a>
              </div>
              <div v-if="media.bannerUrl" class="flex items-center gap-2 text-neutral-300">
                <span class="text-neutral-500 min-w-[4.5rem]">Banner</span>
                <a :href="media.bannerUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ media.bannerUrl }}</a>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.nameJa') }}</label>
            <input
              v-model="form.nameJa"
              lang="ja"
              type="text"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.nameRomaji') }}</label>
            <input
              v-model="form.nameRomaji"
              type="text"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.nameEn') }}</label>
            <input
              v-model="form.nameEn"
              type="text"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.studio') }}</label>
          <input
            v-model="form.studio"
            type="text"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.genres') }}</label>
          <input
            v-model="form.genres"
            type="text"
            :placeholder="t('modalMediaEdit.genresPlaceholder')"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-amber-400 mb-2">{{ t('modalMediaEdit.category') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in categoryOptions"
              :key="opt"
              type="button"
              :class="pillClasses(form.category === opt)"
              @click="form.category = opt"
            >
              {{ opt }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-amber-400 mb-2">{{ t('modalMediaEdit.airingStatus') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in airingStatusOptions"
              :key="opt"
              type="button"
              :class="pillClasses(form.airingStatus === opt)"
              @click="form.airingStatus = opt"
            >
              {{ opt }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">{{ t('modalMediaEdit.airingFormat') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in airingFormatOptions"
              :key="opt"
              type="button"
              :class="pillClasses(form.airingFormat === opt)"
              @click="form.airingFormat = opt"
            >
              {{ opt }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.startDate') }}</label>
            <input
              v-model="form.startDate"
              type="date"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.endDate') }}</label>
            <input
              v-model="form.endDate"
              type="date"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.seasonName') }}</label>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="opt in seasonOptions"
                :key="opt"
                type="button"
                :class="pillClasses(form.seasonName === opt)"
                @click="form.seasonName = opt"
              >
                {{ opt }}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">{{ t('modalMediaEdit.seasonYear') }}</label>
            <input
              v-model.number="form.seasonYear"
              type="number"
              min="1900"
              max="2100"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">{{ t('modalMediaEdit.externalIds') }}</label>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-xs text-neutral-500 mb-1">AniList ID</label>
              <input
                v-model="form.anilistId"
                type="text"
                placeholder="e.g. 21459"
                class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs text-neutral-500 mb-1">IMDB ID</label>
              <input
                v-model="form.imdbId"
                type="text"
                placeholder="e.g. tt1234567"
                class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs text-neutral-500 mb-1">TVDB ID</label>
              <input
                v-model="form.tvdbId"
                type="text"
                placeholder="e.g. 12345"
                class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              />
            </div>
            <div>
              <label class="block text-xs text-neutral-500 mb-1">TMDB ID</label>
              <input
                v-model="form.tmdbId"
                type="text"
                placeholder="e.g. 90955"
                class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-between items-center py-3 px-4 border-t dark:border-modal-border">
        <div>
          <template v-if="!showDeleteConfirm">
            <button
              type="button"
              class="py-2 px-3 text-sm font-medium rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
              @click="showDeleteConfirm = true"
            >
              {{ t('modalMediaEdit.delete') }}
            </button>
          </template>
          <template v-else>
            <div class="flex items-center gap-2">
              <span class="text-sm text-red-400">{{ t('modalMediaEdit.deleteConfirm') }}</span>
              <button
                type="button"
                :disabled="isDeleting"
                class="py-1.5 px-3 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:pointer-events-none"
                @click="submitDelete"
              >
                <span
                  v-if="isDeleting"
                  class="animate-spin inline-block w-3.5 h-3.5 border-[2px] border-current border-t-transparent rounded-full mr-1"
                />
                {{ isDeleting ? t('modalMediaEdit.deleting') : t('modalMediaEdit.confirmYes') }}
              </button>
              <button
                type="button"
                class="py-1.5 px-3 text-sm font-medium rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
                @click="showDeleteConfirm = false"
              >
                {{ t('modalMediaEdit.confirmNo') }}
              </button>
            </div>
          </template>
        </div>
        <div class="flex items-center gap-x-2">
          <button
            type="button"
            class="py-2 px-3 text-sm font-medium rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
            :data-nd-overlay="OVERLAY_ID"
          >
            {{ t('modalMediaEdit.cancel') }}
          </button>
          <button
            type="button"
            :disabled="isSubmitting"
            class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-accent-main text-white hover:bg-button-accent-hover disabled:opacity-50 disabled:pointer-events-none"
            @click="submitEdit"
          >
            <span
              v-if="isSubmitting"
              class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
            />
            {{ isSubmitting ? t('modalMediaEdit.saving') : t('modalMediaEdit.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
