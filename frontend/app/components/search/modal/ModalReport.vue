<script setup lang="ts">
import type { SearchResult } from '~/types/search';
import type { CreateReportRequest } from '@brigadasos/nadeshiko-sdk';
import { mdiTranslate } from '@mdi/js';

const { t } = useI18n();

const props = defineProps<{
  target:
    | {
        type: 'SEGMENT';
        mediaId: number;
        segmentId: string;
      }
    | {
        type: 'MEDIA';
        mediaId: number;
      }
    | null;
  segment: SearchResult | null;
  mediaName?: string;
}>();

const isSubmitting = ref(false);
const errorMessage = ref('');

const form = reactive({
  reason: '',
  description: '',
});

const segmentReasons = [
  'WRONG_TRANSLATION',
  'WRONG_TIMING',
  'WRONG_AUDIO',
  'NSFW_NOT_TAGGED',
  'DUPLICATE_SEGMENT',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

const mediaReasons = [
  'WRONG_METADATA',
  'MISSING_EPISODES',
  'WRONG_COVER_IMAGE',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

const availableReasons = computed(() => (props.target?.type === 'SEGMENT' ? segmentReasons : mediaReasons));

const selectReason = (reason: string) => {
  form.reason = reason;
};

const reasonPillClasses = (reason: string) => {
  const base =
    'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-900 cursor-pointer';
  if (form.reason !== reason)
    return `${base} border border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-300`;
  return `${base} bg-button-danger-main text-white border border-transparent focus:ring-button-danger-main`;
};

const contentRatingBadgeClasses: Record<string, string> = {
  SAFE: 'bg-green-600/30 text-green-300 border border-green-700',
  SUGGESTIVE: 'bg-amber-600/30 text-amber-300 border border-amber-700',
  QUESTIONABLE: 'bg-orange-600/30 text-orange-300 border border-orange-700',
  EXPLICIT: 'bg-red-600/30 text-red-300 border border-red-700',
};

const copyUuid = async () => {
  if (!props.segment) return;
  await navigator.clipboard.writeText(props.segment.segment.uuid);
};

watch(
  () => props.target,
  () => {
    form.reason = '';
    form.description = '';
    errorMessage.value = '';
  },
);

const closeModal = () => {
  const overlay = document.querySelector('#nd-vertically-centered-scrollable-report');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('open');
  }
};

const submitReport = async () => {
  if (!props.target || isSubmitting.value || !form.reason) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const sdk = useNadeshikoSdk();
    const { error } = await sdk.createUserReport({
      body: {
        target: props.target,
        reason: form.reason as CreateReportRequest['reason'],
        description: form.description || undefined,
      },
    });

    if (error) {
      errorMessage.value = error.detail || t('reports.submitError');
      return;
    }

    useToastSuccess(t('reports.submitSuccess'));
    closeModal();
  } catch {
    errorMessage.value = t('reports.submitError');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div
    id="nd-vertically-centered-scrollable-report"
    class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/60 hidden w-full h-full flex items-center justify-center fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="w-full max-w-2xl mx-auto flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
    >
      <!-- Header -->
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('reports.modalTitle') }}
        </h3>
        <button
          type="button"
          class="nd-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
          data-nd-overlay="#nd-vertically-centered-scrollable-report"
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

        <!-- Segment metadata (read-only) -->
        <div v-if="segment" class="rounded-lg bg-neutral-800/50 border border-neutral-700 p-3 space-y-2 text-sm">
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
            <span class="font-mono text-neutral-300">#{{ segment.segment.id }} · {{ t('modalSegmentEdit.metadata.position') }} {{ segment.segment.position }}</span>
          </div>
          <!-- UUID -->
          <div class="flex items-center gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.uuid') }}</span>
            <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[18rem]">{{ segment.segment.uuid }}</code>
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
            <span class="text-white text-sm leading-relaxed">{{ segment.segment.textJa.content }}</span>
          </div>
          <!-- English text -->
          <div v-if="segment.segment.textEn.content" class="flex gap-2 text-neutral-300">
            <span class="text-neutral-500 min-w-[4.5rem] mt-0.5 flex-shrink-0">{{ t('modalSegmentEdit.english') }}</span>
            <span class="text-neutral-300 text-sm leading-relaxed">{{ segment.segment.textEn.content }}</span>
            <div v-if="segment.segment.textEn.isMachineTranslated" class="relative inline-flex group/mt-tooltip align-middle ml-1 flex-shrink-0 self-start mt-0.5">
              <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4" h="h-4" size="19" />
              <span class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-white shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/mt-tooltip:opacity-100 group-hover/mt-tooltip:visible" role="tooltip">
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
              <span class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-white shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/mt-tooltip:opacity-100 group-hover/mt-tooltip:visible" role="tooltip">
                {{ t('searchpage.main.labels.mtTooltip') }}
                <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
              </span>
            </div>
          </div>
        </div>

        <!-- Media-only target (no segment) -->
        <div v-else-if="target" class="rounded-lg bg-neutral-800/50 border border-neutral-700 p-3 text-sm">
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
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
        <button
          type="button"
          class="py-2 px-3 text-sm font-medium rounded-lg border border-neutral-600 text-gray-300 hover:bg-neutral-700"
          data-nd-overlay="#nd-vertically-centered-scrollable-report"
        >
          {{ t('reports.cancel') }}
        </button>
        <button
          type="button"
          :disabled="isSubmitting || !form.reason"
          class="py-2 px-4 text-sm font-semibold rounded-lg bg-button-danger-main text-white hover:bg-button-danger-hover disabled:opacity-50 disabled:pointer-events-none"
          @click="submitReport"
        >
          <span
            v-if="isSubmitting"
            class="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full mr-1"
          />
          {{ isSubmitting ? t('reports.submitting') : t('reports.submit') }}
        </button>
      </div>
    </div>
  </div>
</template>
