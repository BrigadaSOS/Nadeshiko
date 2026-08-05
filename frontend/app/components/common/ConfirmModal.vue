<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    confirmClass?: string;
  }>(),
  {
    confirmLabel: undefined,
    confirmClass: 'bg-red-600 text-white hover:bg-red-500',
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();

// Resolved here rather than as a prop default: prop defaults are evaluated
// outside setup scope, where `t` is not available.
const resolvedConfirmLabel = computed(() => props.confirmLabel ?? t('common.confirm'));
</script>

<template>
  <CommonBaseModal
    :open="visible"
    z-index-class="z-50"
    overlay-class="items-center justify-center bg-black/60"
    panel-class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-sm"
    :label="title"
    @close="emit('cancel')"
  >
    <h3 class="text-lg font-bold text-white mb-2">{{ title }}</h3>
    <p class="text-sm text-gray-400 mb-5">
      <slot>{{ description }}</slot>
    </p>
    <div class="flex justify-end gap-2">
      <button
        class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        class="px-4 py-2 text-sm rounded-lg"
        :class="confirmClass"
        @click="emit('confirm')"
      >
        {{ resolvedConfirmLabel }}
      </button>
    </div>
  </CommonBaseModal>
</template>
