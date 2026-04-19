<script setup lang="ts">
import type { SearchResult, Segment } from '~/types/search';
import type { SegmentRevision, SegmentUpdateRequest } from '@brigadasos/nadeshiko-sdk';

const { t } = useI18n();

const props = defineProps<{
  segment: SearchResult | null;
}>();

const emit = defineEmits<{
  'update:success': [result: SearchResult];
}>();

const isSubmitting = ref(false);
const isLoadingInternal = ref(false);
const errorMessage = ref('');

const showHistory = ref(true);
const revisions = ref<SegmentRevision[]>([]);
const activeSnapshotNumber = ref<number | null>(null);
const isLoadingRevisions = ref(false);

const form = reactive({
  ja: '',
  en: '',
  enMt: false,
  es: '',
  esMt: false,
  status: 'ACTIVE' as Segment['status'],
  contentRating: 'SAFE' as Segment['contentRating'],
  position: 0,
  startTimeMs: 0,
  endTimeMs: 0,
  ratingAnalysisJson: '',
  posAnalysisJson: '',
});

const jsonErrors = reactive({
  ratingAnalysis: '',
  posAnalysis: '',
});

const statusOptions = [
  { value: 'ACTIVE', color: 'green' },
  { value: 'HIDDEN', color: 'amber' },
  { value: 'DELETED', color: 'red' },
] as const;

const contentRatingOptions = [
  { value: 'SAFE', color: 'green' },
  { value: 'SUGGESTIVE', color: 'amber' },
  { value: 'QUESTIONABLE', color: 'orange' },
  { value: 'EXPLICIT', color: 'red' },
] as const;

const TEXT_MAX_LENGTH = 500;

const charCountColor = (len: number) => {
  if (len >= TEXT_MAX_LENGTH) return 'text-red-400';
  if (len >= TEXT_MAX_LENGTH * 0.8) return 'text-amber-400';
  return 'text-neutral-500';
};

const statusPillClasses = (value: string, active: boolean) => {
  const base =
    'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-900 cursor-pointer';
  if (!active)
    return `${base} border border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-300`;
  const colors: Record<string, string> = {
    green: 'bg-green-600/80 text-green-100 border border-green-500 focus:ring-green-500',
    blue: 'bg-blue-600/80 text-blue-100 border border-blue-500 focus:ring-blue-500',
    amber: 'bg-amber-600/80 text-amber-100 border border-amber-500 focus:ring-amber-500',
    red: 'bg-red-600/80 text-red-100 border border-red-500 focus:ring-red-500',
    gray: 'bg-neutral-600/80 text-neutral-200 border border-neutral-500 focus:ring-neutral-500',
    orange: 'bg-orange-600/80 text-orange-100 border border-orange-500 focus:ring-orange-500',
  };
  const opt = [...statusOptions, ...contentRatingOptions].find((o) => o.value === value);
  return `${base} ${colors[opt?.color ?? 'gray']}`;
};

const copyUuid = async () => {
  if (!props.segment) return;
  await navigator.clipboard.writeText(props.segment.segment.publicId);
};

const copyPublicId = async () => {
  if (!props.segment) return;
  await navigator.clipboard.writeText(props.segment.segment.publicId);
};

const validateJson = (json: string, field: 'ratingAnalysis' | 'posAnalysis'): boolean => {
  if (!json.trim()) {
    jsonErrors[field] = '';
    return true;
  }
  try {
    JSON.parse(json);
    jsonErrors[field] = '';
    return true;
  } catch {
    jsonErrors[field] = t('modalSegmentEdit.invalidJson');
    return false;
  }
};

const sdk = useNadeshikoSdk();

const populateFormFromSegment = (seg: SearchResult, ratingAnalysis?: object | null, posAnalysis?: object | null) => {
  form.ja = seg.segment.textJa.content || '';
  form.en = seg.segment.textEn.content || '';
  form.enMt = seg.segment.textEn.isMachineTranslated;
  form.es = seg.segment.textEs.content || '';
  form.esMt = seg.segment.textEs.isMachineTranslated;
  form.status = seg.segment.status;
  form.contentRating = seg.segment.contentRating || 'SAFE';
  form.position = seg.segment.position;
  form.startTimeMs = seg.segment.startTimeMs;
  form.endTimeMs = seg.segment.endTimeMs;
  form.ratingAnalysisJson = ratingAnalysis ? JSON.stringify(ratingAnalysis, null, 2) : '';
  form.posAnalysisJson = posAnalysis ? JSON.stringify(posAnalysis, null, 2) : '';
};

let lastRatingAnalysis: object | null = null;
let lastPosAnalysis: object | null = null;

const internalHashedId = ref<string | null>(null);
const internalStorage = ref<string | null>(null);
const internalStorageBasePath = ref<string | null>(null);

watch(
  () => props.segment,
  async (seg) => {
    if (!seg) return;

    populateFormFromSegment(seg);
    jsonErrors.ratingAnalysis = '';
    jsonErrors.posAnalysis = '';
    errorMessage.value = '';
    activeSnapshotNumber.value = null;
    revisions.value = [];

    internalHashedId.value = null;
    internalStorage.value = null;
    internalStorageBasePath.value = null;

    isLoadingInternal.value = false;

    if (showHistory.value) {
      fetchRevisions();
    }
  },
);

const toggleHistory = async () => {
  showHistory.value = !showHistory.value;
  if (showHistory.value && revisions.value.length === 0) {
    await fetchRevisions();
  }
};

const fetchRevisions = async () => {
  if (!props.segment) return;
  isLoadingRevisions.value = true;
  try {
    const data = await sdk.listSegmentRevisions(props.segment.segment.publicId);
    revisions.value = data.revisions;
  } catch {
    revisions.value = [];
  } finally {
    isLoadingRevisions.value = false;
  }
};

const loadSnapshot = (snapshot: Record<string, unknown>) => {
  form.ja = (snapshot.contentJa as string) ?? '';
  form.en = (snapshot.contentEn as string) ?? '';
  form.enMt = (snapshot.contentEnMt as boolean) ?? false;
  form.es = (snapshot.contentEs as string) ?? '';
  form.esMt = (snapshot.contentEsMt as boolean) ?? false;
  form.status = (snapshot.status as Segment['status']) ?? 'ACTIVE';
  form.contentRating = (snapshot.contentRating as Segment['contentRating']) ?? 'SAFE';
  form.position = (snapshot.position as number) ?? 0;
  form.startTimeMs = (snapshot.startTimeMs as number) ?? 0;
  form.endTimeMs = (snapshot.endTimeMs as number) ?? 0;
  form.ratingAnalysisJson = snapshot.ratingAnalysis ? JSON.stringify(snapshot.ratingAnalysis, null, 2) : '';
  form.posAnalysisJson = snapshot.posAnalysis ? JSON.stringify(snapshot.posAnalysis, null, 2) : '';
};

const restoreCurrent = () => {
  if (!props.segment) return;
  activeSnapshotNumber.value = null;
  populateFormFromSegment(props.segment, lastRatingAnalysis, lastPosAnalysis);
};

const formatRelativeTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const closeModal = () => {
  window.NDOverlay?.close('#nd-vertically-centered-scrollable-segment-edit');
};

const showDeleteEpisodeConfirm = ref(false);
const isDeletingEpisode = ref(false);

const deleteEpisode = async () => {
  if (!props.segment || isDeletingEpisode.value) return;

  isDeletingEpisode.value = true;
  errorMessage.value = '';

  try {
    await sdk.deleteEpisode({
      mediaPublicId: props.segment.media.publicId,
      episodeNumber: props.segment.segment.episode,
    });

    useToastSuccess(t('modalSegmentEdit.deleteEpisodeSuccess'));
    closeModal();
    window.location.reload();
  } catch {
    errorMessage.value = t('modalSegmentEdit.deleteEpisodeError');
  } finally {
    isDeletingEpisode.value = false;
    showDeleteEpisodeConfirm.value = false;
  }
};

const submitEdit = async () => {
  if (!props.segment || isSubmitting.value) return;

  const ratingValid = validateJson(form.ratingAnalysisJson, 'ratingAnalysis');
  const posValid = validateJson(form.posAnalysisJson, 'posAnalysis');
  if (!ratingValid || !posValid) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const body: SegmentUpdateRequest = {
      textJa: { content: form.ja },
      textEn: { content: form.en, isMachineTranslated: form.enMt },
      textEs: { content: form.es, isMachineTranslated: form.esMt },
      status: form.status as SegmentUpdateRequest['status'],
      contentRating: form.contentRating as SegmentUpdateRequest['contentRating'],
      position: form.position,
      startTimeMs: form.startTimeMs,
      endTimeMs: form.endTimeMs,
    };

    if (form.ratingAnalysisJson.trim()) {
      body.ratingAnalysis = JSON.parse(form.ratingAnalysisJson);
    }
    if (form.posAnalysisJson.trim()) {
      body.posAnalysis = JSON.parse(form.posAnalysisJson);
    }

    const updatedSegment = await sdk.updateSegment({
      segmentPublicId: props.segment.segment.publicId,
      ...body,
    });
    lastRatingAnalysis = updatedSegment.ratingAnalysis ?? null;
    lastPosAnalysis = updatedSegment.posAnalysis ?? null;
    internalHashedId.value = updatedSegment.hashedId ?? null;
    internalStorage.value = updatedSegment.storage ?? null;
    internalStorageBasePath.value = updatedSegment.storageBasePath ?? null;

    const updated: SearchResult = {
      ...props.segment,
      segment: {
        ...props.segment.segment,
        textJa: { ...props.segment.segment.textJa, content: form.ja },
        textEn: { ...props.segment.segment.textEn, content: form.en, isMachineTranslated: form.enMt },
        textEs: { ...props.segment.segment.textEs, content: form.es, isMachineTranslated: form.esMt },
        status: form.status,
        contentRating: form.contentRating,
        position: form.position,
        startTimeMs: form.startTimeMs,
        endTimeMs: form.endTimeMs,
      },
    };

    activeSnapshotNumber.value = null;
    lastRatingAnalysis = form.ratingAnalysisJson.trim() ? JSON.parse(form.ratingAnalysisJson) : null;
    lastPosAnalysis = form.posAnalysisJson.trim() ? JSON.parse(form.posAnalysisJson) : null;

    if (showHistory.value) {
      fetchRevisions();
    }

    emit('update:success', updated);
    useToastSuccess(t('modalSegmentEdit.saveSuccess'));
    closeModal();
  } catch {
    errorMessage.value = t('modalSegmentEdit.saveError');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div
    id="nd-vertically-centered-scrollable-segment-edit"
    class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/60 hidden w-full h-full flex items-center justify-center fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="mx-auto flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border transition-all duration-200"
      :class="showHistory ? 'w-full max-w-6xl' : 'w-full max-w-3xl'"
    >
      <!-- Header -->
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('modalSegmentEdit.title') }}
        </h3>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            :title="t('modalSegmentEdit.historyToggle')"
            @click="toggleHistory"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            type="button"
            class="nd-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-nd-overlay="#nd-vertically-centered-scrollable-segment-edit"
          >
            <span class="sr-only">{{ t('modalSegmentEdit.close') }}</span>
            <svg class="w-3.5 h-3.5" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M0.258 1.007a.75.75 0 011.06 0L3.612 3.653 6.258 1.007a.75.75 0 111.06 1.06L4.672 4.36l2.647 2.647a.75.75 0 11-1.06 1.06L3.612 5.42l-2.647 2.646a.75.75 0 11-1.06-1.06L2.553 4.36.258 2.067a.75.75 0 010-1.06z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="flex overflow-hidden">
        <!-- Form panel -->
        <div class="flex-1 min-w-0 p-4 overflow-y-auto max-h-[70vh] space-y-5">
          <!-- Viewing snapshot indicator -->
          <div
            v-if="activeSnapshotNumber !== null"
            class="p-2.5 text-sm text-blue-300 bg-blue-900/20 border border-blue-700 rounded-lg flex items-center justify-between"
          >
            <span>{{ t('modalSegmentEdit.viewingSnapshot', { n: activeSnapshotNumber }) }}</span>
            <button
              type="button"
              class="text-xs text-blue-400 hover:text-blue-300 underline"
              @click="restoreCurrent"
            >
              {{ t('modalSegmentEdit.current') }}
            </button>
          </div>

          <!-- Error -->
          <div
            v-if="errorMessage"
            class="p-3 text-sm text-red-400 bg-red-900/20 border border-red-700 rounded-lg"
          >
            {{ errorMessage }}
          </div>

          <!-- Metadata Header -->
          <div v-if="segment" class="rounded-lg bg-neutral-800/50 border border-neutral-700 p-3 space-y-2 text-sm">
            <!-- Media name + cover thumbnail -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.media') }}</span>
              <img
                v-if="segment.media.coverUrl"
                :src="segment.media.coverUrl"
                class="w-10 h-10 rounded object-cover flex-shrink-0 text-transparent"
                :alt="segment.media.nameRomaji"
                @error="($event.target as HTMLImageElement).classList.remove('text-transparent')"
              />
              <span class="font-medium text-white truncate">{{ segment.media.nameRomaji }}</span>
              <span class="text-neutral-500">—</span>
              <span class="text-neutral-400">{{ t('modalSegmentEdit.metadata.episode') }} {{ segment.segment.episode }}</span>
            </div>
            <!-- Time -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.time') }}</span>
              <span class="font-mono text-neutral-300">{{ formatMs(segment.segment.startTimeMs) }} → {{ formatMs(segment.segment.endTimeMs) }}</span>
            </div>
            <!-- Duration -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.duration') }}</span>
              <span class="font-mono text-neutral-300">{{ ((segment.segment.endTimeMs - segment.segment.startTimeMs) / 1000).toFixed(2) }}s</span>
            </div>
            <!-- ID + position -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.id') }}</span>
              <span class="font-mono text-neutral-300">#{{ segment.segment.publicId }} · {{ t('modalSegmentEdit.metadata.position') }} {{ segment.segment.position }}</span>
            </div>
            <!-- UUID -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.uuid') }}</span>
              <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ segment.segment.publicId }}</code>
              <button
                type="button"
                class="text-neutral-500 hover:text-neutral-300 transition-colors"
                :title="t('modalSegmentEdit.metadata.copyUuid')"
                @click="copyUuid"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            </div>
            <!-- Public ID -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.publicId') }}</span>
              <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ segment.segment.publicId }}</code>
              <button
                type="button"
                class="text-neutral-500 hover:text-neutral-300 transition-colors"
                :title="t('modalSegmentEdit.metadata.copyPublicId')"
                @click="copyPublicId"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            </div>
            <!-- Media ID -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.mediaId') }}</span>
              <span class="font-mono text-neutral-300">{{ segment.segment.mediaPublicId }}</span>
            </div>
            <!-- Hashed ID (from internal fetch) -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.hashedId') }}</span>
              <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
              <code v-else-if="internalHashedId" class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ internalHashedId }}</code>
              <span v-else class="text-xs text-neutral-500">—</span>
            </div>
            <!-- Storage -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.storage') }}</span>
              <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
              <span v-else-if="internalStorage" class="font-mono text-neutral-300">{{ internalStorage }}</span>
              <span v-else class="text-xs text-neutral-500">—</span>
            </div>
            <!-- Storage Path -->
            <div class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.storagePath') }}</span>
              <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
              <code v-else-if="internalStorageBasePath" class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ internalStorageBasePath }}</code>
              <span v-else class="text-xs text-neutral-500">—</span>
            </div>
            <!-- Resource URLs -->
            <div v-if="segment.segment.urls.imageUrl" class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.image') }}</span>
              <a :href="segment.segment.urls.imageUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.imageUrl }}</a>
            </div>
            <div v-if="segment.segment.urls.audioUrl" class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.audio') }}</span>
              <a :href="segment.segment.urls.audioUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.audioUrl }}</a>
            </div>
            <div v-if="segment.segment.urls.videoUrl" class="flex items-center gap-2 text-neutral-300">
              <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.video') }}</span>
              <a :href="segment.segment.urls.videoUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.videoUrl }}</a>
            </div>
          </div>

          <!-- Japanese -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">
              {{ t('modalSegmentEdit.japanese') }}
            </label>
            <textarea
              v-model="form.ja"
              lang="ja"
              :maxlength="TEXT_MAX_LENGTH"
              rows="2"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
            <div class="text-right text-xs mt-0.5" :class="charCountColor(form.ja.length)">
              {{ form.ja.length }}/{{ TEXT_MAX_LENGTH }}
            </div>
          </div>

          <!-- English -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300">
                {{ t('modalSegmentEdit.english') }}
              </label>
              <label class="toggle-switch">
                <input v-model="form.enMt" type="checkbox" class="sr-only peer" />
                <span class="toggle-track peer-checked:bg-button-accent-main peer-focus-visible:ring-2 peer-focus-visible:ring-input-focus-ring" />
                <span class="ml-2 text-xs text-neutral-400">{{ t('modalSegmentEdit.machineTranslated') }}</span>
              </label>
            </div>
            <textarea
              v-model="form.en"
              :maxlength="TEXT_MAX_LENGTH"
              rows="2"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
            <div class="text-right text-xs mt-0.5" :class="charCountColor(form.en.length)">
              {{ form.en.length }}/{{ TEXT_MAX_LENGTH }}
            </div>
          </div>

          <!-- Spanish -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300">
                {{ t('modalSegmentEdit.spanish') }}
              </label>
              <label class="toggle-switch">
                <input v-model="form.esMt" type="checkbox" class="sr-only peer" />
                <span class="toggle-track peer-checked:bg-button-accent-main peer-focus-visible:ring-2 peer-focus-visible:ring-input-focus-ring" />
                <span class="ml-2 text-xs text-neutral-400">{{ t('modalSegmentEdit.machineTranslated') }}</span>
              </label>
            </div>
            <textarea
              v-model="form.es"
              :maxlength="TEXT_MAX_LENGTH"
              rows="2"
              class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
            />
            <div class="text-right text-xs mt-0.5" :class="charCountColor(form.es.length)">
              {{ form.es.length }}/{{ TEXT_MAX_LENGTH }}
            </div>
          </div>

          <!-- Position + Timing -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              {{ t('modalSegmentEdit.timing') }}
            </label>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs text-neutral-500 mb-1">{{ t('modalSegmentEdit.position') }}</label>
                <input
                  v-model.number="form.position"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
                />
              </div>
              <div>
                <label class="block text-xs text-neutral-500 mb-1">{{ t('modalSegmentEdit.startTimeMs') }}</label>
                <input
                  v-model.number="form.startTimeMs"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
                />
              </div>
              <div>
                <label class="block text-xs text-neutral-500 mb-1">{{ t('modalSegmentEdit.endTimeMs') }}</label>
                <input
                  v-model.number="form.endTimeMs"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <!-- Status -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              {{ t('modalSegmentEdit.status') }}
            </label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                :class="statusPillClasses(opt.value, form.status === opt.value)"
                @click="form.status = opt.value"
              >
                {{ t(`segment.status.${opt.value}`) }}
              </button>
            </div>
          </div>

          <!-- Content Rating -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              {{ t('modalSegmentEdit.contentRating') }}
            </label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in contentRatingOptions"
                :key="opt.value"
                type="button"
                :class="statusPillClasses(opt.value, form.contentRating === opt.value)"
                @click="form.contentRating = opt.value"
              >
                {{ t(`segment.contentRating.${opt.value}`) }}
              </button>
            </div>
          </div>

          <!-- Rating Analysis -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300">
                {{ t('modalSegmentEdit.ratingAnalysis') }}
              </label>
              <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
            </div>
            <p class="text-xs text-neutral-500 mb-1.5">{{ t('modalSegmentEdit.ratingAnalysisDesc') }}</p>
            <textarea
              v-model="form.ratingAnalysisJson"
              rows="6"
              class="w-full rounded-lg border bg-neutral-900 text-neutral-200 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              :class="jsonErrors.ratingAnalysis ? 'border-red-500' : 'border-neutral-600'"
              @blur="validateJson(form.ratingAnalysisJson, 'ratingAnalysis')"
            />
            <p v-if="jsonErrors.ratingAnalysis" class="text-xs text-red-400 mt-0.5">{{ jsonErrors.ratingAnalysis }}</p>
          </div>

          <!-- POS Analysis -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300">
                {{ t('modalSegmentEdit.posAnalysis') }}
              </label>
              <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
            </div>
            <p class="text-xs text-neutral-500 mb-1.5">{{ t('modalSegmentEdit.posAnalysisDesc') }}</p>
            <textarea
              v-model="form.posAnalysisJson"
              rows="6"
              class="w-full rounded-lg border bg-neutral-900 text-neutral-200 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-input-focus-ring focus:border-transparent"
              :class="jsonErrors.posAnalysis ? 'border-red-500' : 'border-neutral-600'"
              @blur="validateJson(form.posAnalysisJson, 'posAnalysis')"
            />
            <p v-if="jsonErrors.posAnalysis" class="text-xs text-red-400 mt-0.5">{{ jsonErrors.posAnalysis }}</p>
          </div>
        </div>

        <!-- Vertical divider + History panel -->
        <template v-if="showHistory">
          <div class="w-px bg-neutral-700 flex-shrink-0" />
          <div class="w-80 flex-shrink-0 overflow-y-auto max-h-[70vh] p-4 space-y-2">
            <h4 class="text-sm font-semibold text-neutral-300 mb-3">{{ t('modalSegmentEdit.history') }}</h4>

            <div v-if="isLoadingRevisions" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</div>

            <div v-else-if="revisions.length === 0" class="text-xs text-neutral-500">
              {{ t('modalSegmentEdit.noRevisions') }}
            </div>

            <template v-else>
              <!-- Current button -->
              <button
                type="button"
                class="w-full text-left rounded-lg border p-2.5 text-sm transition-colors"
                :class="activeSnapshotNumber === null
                  ? 'border-blue-500 bg-blue-900/20 text-blue-300'
                  : 'border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:border-neutral-500'"
                @click="restoreCurrent"
              >
                <span class="font-medium">{{ t('modalSegmentEdit.current') }}</span>
              </button>

              <!-- Revision cards -->
              <button
                v-for="rev in revisions"
                :key="rev.id"
                type="button"
                class="w-full text-left rounded-lg border p-2.5 text-sm transition-colors"
                :class="activeSnapshotNumber === rev.revisionNumber
                  ? 'border-blue-500 bg-blue-900/20 text-blue-300'
                  : 'border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:border-neutral-500'"
                @click="activeSnapshotNumber = rev.revisionNumber; loadSnapshot(rev.snapshot)"
              >
                <div class="font-medium">{{ t('modalSegmentEdit.snapshot') }} {{ rev.revisionNumber }}</div>
                <div class="text-xs mt-0.5 text-neutral-500">
                  {{ formatRelativeTime(rev.createdAt) }}
                  <span v-if="rev.userName"> · {{ rev.userName }}</span>
                </div>
              </button>
            </template>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="flex items-center py-3 px-4 border-t dark:border-modal-border">
        <!-- Delete Episode (left side) -->
        <div class="flex items-center gap-2">
          <template v-if="!showDeleteEpisodeConfirm">
            <button
              type="button"
              class="py-2 px-3 text-sm font-medium rounded-lg border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors"
              @click="showDeleteEpisodeConfirm = true"
            >
              {{ t('modalSegmentEdit.deleteEpisode') }}
            </button>
          </template>
          <template v-else>
            <span class="text-sm text-red-400">{{ t('modalSegmentEdit.deleteEpisodeConfirm', { episode: segment?.segment.episode }) }}</span>
            <button
              type="button"
              :disabled="isDeletingEpisode"
              class="py-1.5 px-3 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none"
              @click="deleteEpisode"
            >
              <span
                v-if="isDeletingEpisode"
                class="animate-spin inline-block w-3 h-3 border-[2px] border-current border-t-transparent rounded-full mr-1"
              />
              {{ t('modalSegmentEdit.deleteEpisodeYes') }}
            </button>
            <button
              type="button"
              class="py-1.5 px-3 text-sm font-medium rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
              @click="showDeleteEpisodeConfirm = false"
            >
              {{ t('modalSegmentEdit.cancel') }}
            </button>
          </template>
        </div>

        <!-- Save / Cancel (right side) -->
        <div class="flex items-center gap-x-2 ml-auto">
          <button
            type="button"
            class="py-2 px-3 text-sm font-medium rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
            data-nd-overlay="#nd-vertically-centered-scrollable-segment-edit"
          >
            {{ t('modalSegmentEdit.cancel') }}
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
            {{ isSubmitting ? t('modalSegmentEdit.saving') : t('modalSegmentEdit.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toggle-switch {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.toggle-track {
  position: relative;
  display: inline-block;
  width: 2.25rem;
  height: 1.25rem;
  background-color: rgb(64 64 64);
  border-radius: 9999px;
  transition: background-color 150ms ease;
  flex-shrink: 0;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 1rem;
  height: 1rem;
  background-color: white;
  border-radius: 9999px;
  transition: transform 150ms ease;
}

.peer:checked ~ .toggle-track::after {
  transform: translateX(1rem);
}
</style>
