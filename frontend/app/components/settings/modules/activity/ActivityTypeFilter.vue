<script setup lang="ts">
import { ACTIVITY_TYPES, activityTypeClass, activityTypeLabel, activityTypeMutedClass } from './activityHelpers';

defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [type: string | null];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      :class="[
        'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
        modelValue === null
          ? 'border-white/30 bg-white/15 text-white'
          : 'border-white/15 bg-white/5 text-gray-300/60 hover:text-white hover:bg-white/10',
      ]"
      @click="emit('update:modelValue', null)"
    >
      {{ t('accountSettings.activity.filters.all') }}
    </button>
    <button
      v-for="type in ACTIVITY_TYPES"
      :key="type"
      :class="[
        'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
        modelValue === type
          ? activityTypeClass(type)
          : activityTypeMutedClass(type),
      ]"
      @click="emit('update:modelValue', modelValue === type ? null : type)"
    >
      {{ activityTypeLabel(type, t) }}
    </button>
  </div>
</template>
