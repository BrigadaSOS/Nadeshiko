<script setup lang="ts">
import type { SearchResult } from '~/types/search';
import {
  type SegmentEditFormState,
  type SegmentEditJsonErrors,
  type SegmentEditJsonField,
  TEXT_MAX_LENGTH,
  validateJson,
} from './segmentEditState';

const props = defineProps<{
  segment: SearchResult | null;
  /** Edited in place — the parent owns the reactive form state. */
  form: SegmentEditFormState;
  jsonErrors: SegmentEditJsonErrors;
  activeSnapshotNumber: number | null;
  errorMessage: string;
  isLoadingInternal: boolean;
  internalHashedId: string | null;
  internalStorage: string | null;
  internalStorageBasePath: string | null;
}>();

const emit = defineEmits<{
  'restore-current': [];
}>();

const { t } = useI18n();

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

const charCountColor = (len: number) => {
  if (len >= TEXT_MAX_LENGTH) return 'text-red-400';
  if (len >= TEXT_MAX_LENGTH * 0.8) return 'text-amber-400';
  return 'text-neutral-500';
};

const statusPillClasses = (value: string, active: boolean) => {
  const base =
    'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-900 cursor-pointer';
  if (!active)
    return `${base} border border-hairline text-ink-muted hover:border-line-hover hover:text-ink`;
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

const validateField = (json: string, field: SegmentEditJsonField) =>
  validateJson(json, field, props.jsonErrors, t('modalSegmentEdit.invalidJson'));
</script>

<template>
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
        @click="emit('restore-current')"
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
    <SearchModalSegmentEditMetadata
      v-if="segment"
      :segment="segment"
      :is-loading-internal="isLoadingInternal"
      :internal-hashed-id="internalHashedId"
      :internal-storage="internalStorage"
      :internal-storage-base-path="internalStorageBasePath"
    />

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
        class="nd-input"
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
        class="nd-input"
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
        class="nd-input"
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
            class="nd-input font-mono"
          />
        </div>
        <div>
          <label class="block text-xs text-neutral-500 mb-1">{{ t('modalSegmentEdit.startTimeMs') }}</label>
          <input
            v-model.number="form.startTimeMs"
            type="number"
            min="0"
            class="nd-input font-mono"
          />
        </div>
        <div>
          <label class="block text-xs text-neutral-500 mb-1">{{ t('modalSegmentEdit.endTimeMs') }}</label>
          <input
            v-model.number="form.endTimeMs"
            type="number"
            min="0"
            class="nd-input font-mono"
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
        :class="jsonErrors.ratingAnalysis ? 'border-red-500' : 'border-hairline'"
        @blur="validateField(form.ratingAnalysisJson, 'ratingAnalysis')"
      />
      <p v-if="jsonErrors.ratingAnalysis" class="text-xs text-red-400 mt-0.5">{{ jsonErrors.ratingAnalysis }}</p>
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
