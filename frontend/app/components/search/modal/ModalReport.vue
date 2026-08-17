<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import type { SearchResult } from '~/types/search';
import type { CreateReportRequest, UserReportTarget } from '@brigadasos/nadeshiko-sdk';
import { mdiTranslate } from '@mdi/js';

const { t } = useI18n();

const props = defineProps<{
  target: UserReportTarget | null;
  segment: SearchResult | null;
  mediaName?: string;
}>();

const isSubmitting = ref(false);
const errorMessage = ref('');
const tab = ref<'SEGMENT' | 'MEDIA'>(props.target?.type === 'MEDIA' ? 'MEDIA' : 'SEGMENT');

const form = reactive({
  reason: '',
  description: '',
});

const segmentReasons = [
  'WRONG_TRANSLATION',
  'WRONG_TIMING',
  'WRONG_AUDIO',
  'WRONG_JAPANESE_TEXT',
  'LOW_QUALITY_AUDIO',
  'NSFW_NOT_TAGGED',
  'DUPLICATE_SEGMENT',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

const mediaReasons = [
  'WRONG_TITLE',
  'DUPLICATE_MEDIA',
  'WRONG_EPISODE_NUMBER',
  'IMAGE_ISSUE',
  'MISSING_EPISODES',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

const availableReasons = computed(() => (tab.value === 'SEGMENT' ? segmentReasons : mediaReasons));

const switchTab = (newTab: 'SEGMENT' | 'MEDIA') => {
  if (tab.value === newTab) return;
  tab.value = newTab;
  form.reason = '';
};

const selectReason = (reason: string) => {
  form.reason = reason;
};

const reasonPillClasses = (reason: string) => {
  const base =
    'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-900 cursor-pointer';
  if (form.reason !== reason)
    return `${base} border border-hairline text-ink-muted hover:border-line-hover hover:text-ink`;
  return `${base} bg-button-accent-main text-white border border-transparent focus:ring-input-focus-ring`;
};

const contentRatingBadgeClasses: Record<string, string> = {
  SAFE: 'bg-green-600/30 text-green-300 border border-green-700',
  SUGGESTIVE: 'bg-amber-600/30 text-amber-300 border border-amber-700',
  QUESTIONABLE: 'bg-orange-600/30 text-orange-300 border border-orange-700',
  EXPLICIT: 'bg-red-600/30 text-red-300 border border-red-700',
};

watch(
  () => props.target,
  () => {
    tab.value = props.target?.type === 'MEDIA' ? 'MEDIA' : 'SEGMENT';
    form.reason = '';
    form.description = '';
    errorMessage.value = '';
  },
);

const emit = defineEmits<{ close: [] }>();

const closeModal = () => {
  emit('close');
};

const submitReport = async () => {
  if (!props.target || isSubmitting.value || !form.reason) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const sdk = useNadeshikoSdk();
    const target: UserReportTarget =
      tab.value === 'SEGMENT' && props.target?.type === 'SEGMENT'
        ? props.target
        : { type: 'MEDIA', mediaPublicId: props.target.mediaPublicId };
    await sdk.createUserReport({
      target,
      reason: form.reason as CreateReportRequest['reason'],
      description: form.description || undefined,
    });

    useToastSuccess(t('reports.submitSuccess'));
    closeModal();
  } catch (error) {
    // Rendered inline inside the still-open modal, next to the form the user filled in.
    handleApiError('reports:submit-failed', error, { toastKey: false });
    errorMessage.value = t('reports.submitError');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <CommonBaseModal
    data-testid="report-modal"
    :open="!!target"
    labelledby="nd-report-modal-title"
    panel-class="w-full max-w-2xl mx-auto flex flex-col bg-background border border-hairline shadow-sm rounded-xl"
    @close="closeModal"
  >
      <!-- Header -->
      <div class="nd-modal-header">
        <h3 id="nd-report-modal-title" class="font-bold text-gray-800 dark:text-white">
          {{ t('reports.modalTitle') }}
        </h3>
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

      <!-- Body -->
      <div class="p-4 overflow-y-auto max-h-[70vh] space-y-4">
        <!-- Error -->
        <div
          v-if="errorMessage"
          class="p-3 text-sm text-red-400 bg-red-900/20 border border-red-700 rounded-lg"
        >
          {{ errorMessage }}
        </div>

        <!-- Tabs -->
        <div class="flex gap-1 bg-neutral-800/60 p-1 rounded-lg">
          <button
            type="button"
            class="flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="tab === 'SEGMENT' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-300'"
            @click="switchTab('SEGMENT')"
          >
            {{ t('reports.tabSegment') }}
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="tab === 'MEDIA' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-300'"
            @click="switchTab('MEDIA')"
          >
            {{ t('reports.tabMedia') }}
          </button>
        </div>

        <!-- Segment metadata (read-only) -->
        <div v-if="segment" class="rounded-lg bg-control border border-hairline p-3 space-y-2 text-sm">
          <!-- Media + cover -->
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.media') }}</span>
            <img
              v-if="segment.media.coverUrl"
              :src="segment.media.coverUrl"
              class="w-10 h-10 rounded object-cover flex-shrink-0 text-transparent"
              :alt="segment.media.nameRomaji"
            />
            <span class="font-medium text-white truncate">{{ segment.media.nameRomaji }}</span>
            <span class="text-neutral-500">—</span>
            <span class="text-neutral-400">{{ t('modalSegmentEdit.metadata.episode') }} {{ segment.segment.episode }}</span>
          </div>
          <!-- Time -->
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.time') }}</span>
            <span class="font-mono text-neutral-300">{{ formatMs(segment.segment.startTimeMs) }} → {{ formatMs(segment.segment.endTimeMs) }}</span>
            <span class="text-neutral-600">·</span>
            <span class="font-mono text-neutral-500 text-xs">{{ ((segment.segment.endTimeMs - segment.segment.startTimeMs) / 1000).toFixed(2) }}s</span>
          </div>
          <!-- ID + position -->
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.id') }}</span>
            <span class="font-mono text-neutral-300">#{{ segment.segment.publicId }} · {{ t('modalSegmentEdit.metadata.position') }} {{ segment.segment.position }}</span>
          </div>
          <!-- Content rating -->
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.contentRating') }}</span>
            <span
              class="px-2 py-0.5 rounded text-xs font-medium"
              :class="contentRatingBadgeClasses[segment.segment.contentRating?.toUpperCase() ?? 'SAFE'] ?? contentRatingBadgeClasses['SAFE']"
            >
              {{ t(`segment.contentRating.${(segment.segment.contentRating || 'SAFE').toUpperCase()}`) }}
            </span>
          </div>
          <!-- Japanese text -->
          <div v-if="segment.segment.textJa.content" class="flex gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem] mt-0.5">{{ t('modalSegmentEdit.japanese') }}</span>
            <span lang="ja" class="text-white text-sm leading-relaxed">{{ segment.segment.textJa.content }}</span>
          </div>
          <!-- English text -->
          <div v-if="segment.segment.textEn.content" class="flex gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem] mt-0.5 flex-shrink-0">{{ t('modalSegmentEdit.english') }}</span>
            <span class="text-neutral-300 text-sm leading-relaxed">{{ segment.segment.textEn.content }}</span>
            <div v-if="segment.segment.textEn.isMachineTranslated" class="relative inline-flex group/mt-tooltip align-middle ml-1 flex-shrink-0 self-start mt-0.5">
              <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4" h="h-4" size="19" />
              <span class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface border border-hairline px-3 py-1.5 text-sm font-medium text-ink shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/mt-tooltip:opacity-100 group-hover/mt-tooltip:visible" role="tooltip">
                {{ t('searchpage.main.labels.mtTooltip') }}
                <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
              </span>
            </div>
          </div>
          <!-- Spanish text -->
          <div v-if="segment.segment.textEs.content" class="flex gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem] mt-0.5 flex-shrink-0">{{ t('modalSegmentEdit.spanish') }}</span>
            <span class="text-neutral-300 text-sm leading-relaxed">{{ segment.segment.textEs.content }}</span>
            <div v-if="segment.segment.textEs.isMachineTranslated" class="relative inline-flex group/mt-tooltip align-middle ml-1 flex-shrink-0 self-start mt-0.5">
              <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4" h="h-4" size="19" />
              <span class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface border border-hairline px-3 py-1.5 text-sm font-medium text-ink shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/mt-tooltip:opacity-100 group-hover/mt-tooltip:visible" role="tooltip">
                {{ t('searchpage.main.labels.mtTooltip') }}
                <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
              </span>
            </div>
          </div>
        </div>

        <!-- Media-only target (no segment) -->
        <div v-else-if="target" class="rounded-lg bg-control border border-hairline p-3 text-sm">
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('reports.targetLabel') }}</span>
            <span class="px-2 py-0.5 rounded text-xs font-medium bg-neutral-700 text-neutral-300">
              {{ target.type.charAt(0) + target.type.slice(1).toLowerCase() }}
            </span>
            <span v-if="mediaName" class="font-medium text-white truncate">{{ mediaName }}</span>
          </div>
        </div>

        <!-- Reason -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            {{ t('reports.reason') }}
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="reason in availableReasons"
              :key="reason"
              type="button"
              :class="reasonPillClasses(reason)"
              @click="selectReason(reason)"
            >
              {{ t(`reports.reasons.${reason}`) }}
            </button>
          </div>
        </div>

        <!-- Description -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('reports.description') }}
          </label>
          <textarea
            v-model="form.description"
            maxlength="1000"
            rows="3"
            :placeholder="t('reports.descriptionPlaceholder')"
            class="nd-input"
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
        <button
          type="button"
          class="py-2 px-3 text-sm font-medium rounded-lg border border-hairline text-ink-muted hover:bg-control-hover"
          @click="closeModal"
        >
          {{ t('reports.cancel') }}
        </button>
        <button
          type="button"
          :disabled="isSubmitting || !form.reason"
          class="nd-btn-accent"
          @click="submitReport"
        >
          <span
            v-if="isSubmitting"
            class="nd-spinner"
          />
          {{ isSubmitting ? t('reports.submitting') : t('reports.submit') }}
        </button>
      </div>
  </CommonBaseModal>
</template>
