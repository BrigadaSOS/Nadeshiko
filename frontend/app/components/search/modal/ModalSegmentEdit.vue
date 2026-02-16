<script setup lang="ts">
import type { SearchResult } from '~/stores/search';

const { t } = useI18n();

const props = defineProps<{
  segment: SearchResult | null;
}>();

const emit = defineEmits<{
  'update:success': [result: SearchResult];
}>();

const isSubmitting = ref(false);
const errorMessage = ref('');

const form = reactive({
  ja: '',
  en: '',
  enMt: false,
  es: '',
  esMt: false,
  status: 'ACTIVE',
  isNsfw: false,
});

const statusOptions = ['DELETED', 'ACTIVE', 'SUSPENDED', 'VERIFIED', 'INVALID', 'TOO_LONG'];

watch(
  () => props.segment,
  (seg) => {
    if (seg) {
      form.ja = seg.segment.textJa.content || '';
      form.en = seg.segment.textEn.content || '';
      form.enMt = seg.segment.textEn.isMachineTranslated;
      form.es = seg.segment.textEs.content || '';
      form.esMt = seg.segment.textEs.isMachineTranslated;
      form.status = seg.segment.status;
      form.isNsfw = seg.segment.isNsfw;
      errorMessage.value = '';
    }
  },
);

const closeModal = () => {
  window.NDOverlay?.close('#nd-vertically-centered-scrollable-segment-edit');
};

const submitEdit = async () => {
  if (!props.segment || isSubmitting.value) return;

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    await $fetch('/api/media/segments/update', {
      method: 'POST',
      body: {
        uuid: props.segment.segment.uuid,
        textJa: form.ja,
        textEn: { content: form.en, isMachineTranslated: form.enMt },
        textEs: { content: form.es, isMachineTranslated: form.esMt },
        status: form.status,
        isNsfw: form.isNsfw,
      },
    });

    // Build updated result for optimistic UI update
    const updated: SearchResult = {
      ...props.segment,
      segment: {
        ...props.segment.segment,
        textJa: { ...props.segment.segment.textJa, content: form.ja },
        textEn: { content: form.en, isMachineTranslated: form.enMt },
        textEs: { content: form.es, isMachineTranslated: form.esMt },
        status: form.status,
        isNsfw: form.isNsfw,
      },
    };

    emit('update:success', updated);
    useToastSuccess(t('modalSegmentEdit.saveSuccess'));
    closeModal();
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.message || t('modalSegmentEdit.saveError');
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
      class="w-full max-w-2xl mx-auto flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
    >
      <!-- Header -->
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('modalSegmentEdit.title') }}
        </h3>
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

      <!-- Body -->
      <div class="p-4 overflow-y-auto max-h-[70vh] space-y-4">
        <!-- Error -->
        <div
          v-if="errorMessage"
          class="p-3 text-sm text-red-400 bg-red-900/20 border border-red-700 rounded-lg"
        >
          {{ errorMessage }}
        </div>

        <!-- Japanese -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('modalSegmentEdit.japanese') }}
          </label>
          <textarea
            v-model="form.ja"
            maxlength="500"
            rows="2"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <!-- English -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('modalSegmentEdit.english') }}
          </label>
          <textarea
            v-model="form.en"
            maxlength="500"
            rows="2"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <label class="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <input v-model="form.enMt" type="checkbox" class="rounded border-neutral-600 bg-neutral-800" />
            {{ t('modalSegmentEdit.machineTranslated') }}
          </label>
        </div>

        <!-- Spanish -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('modalSegmentEdit.spanish') }}
          </label>
          <textarea
            v-model="form.es"
            maxlength="500"
            rows="2"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <label class="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <input v-model="form.esMt" type="checkbox" class="rounded border-neutral-600 bg-neutral-800" />
            {{ t('modalSegmentEdit.machineTranslated') }}
          </label>
        </div>

        <!-- Status -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">
            {{ t('modalSegmentEdit.status') }}
          </label>
          <select
            v-model="form.status"
            class="w-full rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option v-for="opt in statusOptions" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </select>
        </div>

        <!-- NSFW -->
        <div>
          <label class="flex items-center gap-2 text-sm text-gray-300">
            <input v-model="form.isNsfw" type="checkbox" class="rounded border-neutral-600 bg-neutral-800" />
            {{ t('modalSegmentEdit.nsfw') }}
          </label>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
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
          class="py-2 px-4 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
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
</template>
