<script setup lang="ts">
import { authApiRequest } from '~/utils/authApi';

const { t } = useI18n();

const props = defineProps<{
  targetType: 'SEGMENT' | 'MEDIA';
  targetMediaId: number | null;
  targetSegmentUuid?: string | null;
  mediaName?: string;
}>();

const isSubmitting = ref(false);
const errorMessage = ref('');

const form = reactive({
  reason: '' as string,
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

const availableReasons = computed(() =>
  props.targetType === 'SEGMENT' ? segmentReasons : mediaReasons,
);

watch(
  () => props.targetMediaId,
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
  if (!props.targetMediaId || isSubmitting.value || !form.reason) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const response = await authApiRequest('/v1/user/reports', {
      method: 'POST',
      body: {
        targetType: props.targetType,
        targetMediaId: props.targetMediaId,
        targetSegmentUuid: props.targetSegmentUuid || undefined,
        reason: form.reason,
        description: form.description || undefined,
      },
    });

    if (!response.ok) {
      const data = response.data as any;
      throw new Error(data?.message || t('reports.submitError'));
    }

    useToastSuccess(t('reports.submitSuccess'));
    closeModal();
  } catch (err: any) {
    errorMessage.value = err?.message || t('reports.submitError');
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
      class="w-full max-w-lg mx-auto flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
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
          <span class="sr-only">Close</span>
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

        <!-- Info -->
        <p v-if="mediaName" class="text-sm text-gray-400">
          {{ mediaName }}
        </p>

        <!-- Reason -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('reports.reason') }}
          </label>
          <select
            v-model="form.reason"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="" disabled>{{ t('reports.selectReason') }}</option>
            <option v-for="reason in availableReasons" :key="reason" :value="reason">
              {{ t(`reports.reasons.${reason}`) }}
            </option>
          </select>
        </div>

        <!-- Description -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('reports.description') }}
          </label>
          <textarea
            v-model="form.description"
            maxlength="1000"
            rows="4"
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
          class="py-2 px-4 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none"
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
