<script setup lang="ts">
import type { SegmentRevision, SegmentUpdateRequest } from '@brigadasos/nadeshiko-sdk';
import type { SearchResult, Segment } from '~/types/search';
import { handleApiError } from '~/utils/apiError';
import { type SegmentEditFormState, type SegmentEditJsonErrors, validateJson } from './segmentEdit/segmentEditState';

const { t } = useI18n();

const props = defineProps<{
  segment: SearchResult | null;
}>();

const emit = defineEmits<{
  'update:success': [result: SearchResult];
  close: [];
}>();

const isSubmitting = ref(false);
const isLoadingInternal = ref(false);
const errorMessage = ref('');

const showHistory = ref(true);
const revisions = ref<SegmentRevision[]>([]);
const activeSnapshotNumber = ref<number | null>(null);
const isLoadingRevisions = ref(false);

const form = reactive<SegmentEditFormState>({
  ja: '',
  en: '',
  enMt: false,
  es: '',
  esMt: false,
  status: 'ACTIVE',
  contentRating: 'SAFE',
  position: 0,
  startTimeMs: 0,
  endTimeMs: 0,
  ratingAnalysisJson: '',
});

const jsonErrors = reactive<SegmentEditJsonErrors>({
  ratingAnalysis: '',
});

const sdk = useNadeshikoSdk();

const populateFormFromSegment = (seg: SearchResult, ratingAnalysis?: object | null) => {
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
};

let lastRatingAnalysis: object | null = null;

const internalHashedId = ref<string | null>(null);
const internalStorage = ref<string | null>(null);
const internalStorageBasePath = ref<string | null>(null);

watch(
  () => props.segment,
  async (seg) => {
    if (!seg) return;

    populateFormFromSegment(seg);
    jsonErrors.ratingAnalysis = '';
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

/**
 * Which sentence's history the panel is showing.
 *
 * This modal stays MOUNTED as the moderator moves between sentences -- the
 * `segment` prop changes underneath it -- and the history panel is open by
 * default, so each move starts a request while the previous one may still be
 * out. Assigned in arrival order, the older reply won and the panel listed the
 * previous sentence's revisions under the current one. That is not a display
 * fault: selecting a revision loads its text into the form, and the form is what
 * gets saved, so it is a route to writing one sentence's text onto another.
 *
 * The failure path needs the same guard for the mirror-image reason -- clearing
 * the list is right for the sentence that failed and wrong for the one now on
 * screen.
 */
let latestRevisionRequest = 0;

const fetchRevisions = async () => {
  if (!props.segment) return;
  const request = ++latestRevisionRequest;
  isLoadingRevisions.value = true;
  try {
    const data = await sdk.listSegmentRevisions(props.segment.segment.publicId);
    if (request !== latestRevisionRequest) return;
    revisions.value = data.revisions;
  } catch (err) {
    if (request !== latestRevisionRequest) return;
    // The history panel renders its own empty state, so no toast on top of it.
    handleApiError('modalSegmentEdit.fetchRevisions', err, { toastKey: false });
    revisions.value = [];
  } finally {
    if (request === latestRevisionRequest) isLoadingRevisions.value = false;
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
};

const selectRevision = (revision: SegmentRevision) => {
  activeSnapshotNumber.value = revision.revisionNumber;
  loadSnapshot(revision.snapshot);
};

const restoreCurrent = () => {
  if (!props.segment) return;
  activeSnapshotNumber.value = null;
  populateFormFromSegment(props.segment, lastRatingAnalysis);
};

const closeModal = () => {
  emit('close');
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
  } catch (err) {
    // Surfaced inline in the modal body instead of a toast.
    handleApiError('modalSegmentEdit.deleteEpisode', err, { toastKey: false });
    errorMessage.value = t('modalSegmentEdit.deleteEpisodeError');
  } finally {
    isDeletingEpisode.value = false;
    showDeleteEpisodeConfirm.value = false;
  }
};

const submitEdit = async () => {
  if (!props.segment || isSubmitting.value) return;

  const invalidMessage = t('modalSegmentEdit.invalidJson');
  if (!validateJson(form.ratingAnalysisJson, 'ratingAnalysis', jsonErrors, invalidMessage)) return;

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

    const updatedSegment = await sdk.updateSegment({
      segmentPublicId: props.segment.segment.publicId,
      ...body,
    });
    lastRatingAnalysis = updatedSegment.ratingAnalysis ?? null;
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

    if (showHistory.value) {
      fetchRevisions();
    }

    emit('update:success', updated);
    useToastSuccess(t('modalSegmentEdit.saveSuccess'));
    closeModal();
  } catch (err) {
    // Surfaced inline in the modal body instead of a toast.
    handleApiError('modalSegmentEdit.submitEdit', err, { toastKey: false });
    errorMessage.value = t('modalSegmentEdit.saveError');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <CommonBaseModal
    data-testid="segment-edit-modal"
    :open="!!segment"
    labelledby="nd-segment-edit-modal-title"
    :panel-class="[
      'mx-auto flex flex-col bg-background border border-hairline shadow-sm rounded-xl transition-all duration-200',
      showHistory ? 'w-full max-w-6xl' : 'w-full max-w-3xl',
    ]"
    @close="closeModal"
  >
      <!-- Header -->
      <div class="nd-modal-header">
        <h3 id="nd-segment-edit-modal-title" class="font-bold text-gray-800 dark:text-white">
          {{ t('modalSegmentEdit.title') }}
        </h3>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400"
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
            class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400"
            @click="closeModal"
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
        <SearchModalSegmentEditForm
          :segment="segment"
          :form="form"
          :json-errors="jsonErrors"
          :active-snapshot-number="activeSnapshotNumber"
          :error-message="errorMessage"
          :is-loading-internal="isLoadingInternal"
          :internal-hashed-id="internalHashedId"
          :internal-storage="internalStorage"
          :internal-storage-base-path="internalStorageBasePath"
          @restore-current="restoreCurrent"
        />

        <!-- Vertical divider + History panel -->
        <template v-if="showHistory">
          <div class="w-px bg-neutral-700 flex-shrink-0" />
          <SearchModalSegmentEditRevisions
            :revisions="revisions"
            :is-loading="isLoadingRevisions"
            :active-snapshot-number="activeSnapshotNumber"
            @restore-current="restoreCurrent"
            @select-revision="selectRevision"
          />
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
              class="py-1.5 px-3 text-sm font-medium rounded-lg border border-hairline text-ink-muted hover:bg-control-hover"
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
            class="py-2 px-3 text-sm font-medium rounded-lg border border-hairline text-ink-muted hover:bg-control-hover"
            @click="closeModal"
          >
            {{ t('modalSegmentEdit.cancel') }}
          </button>
          <button
            type="button"
            :disabled="isSubmitting"
            class="nd-btn-accent"
            @click="submitEdit"
          >
            <span
              v-if="isSubmitting"
              class="nd-spinner"
            />
            {{ isSubmitting ? t('modalSegmentEdit.saving') : t('modalSegmentEdit.save') }}
          </button>
        </div>
      </div>
  </CommonBaseModal>
</template>
