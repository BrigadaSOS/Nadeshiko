<script setup lang="ts">
withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    confirmClass?: string;
  }>(),
  {
    confirmLabel: 'Confirm',
    confirmClass: 'bg-red-600 text-white hover:bg-red-500',
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('cancel')"
    >
      <div class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-sm">
        <h3 class="text-lg font-bold text-white mb-2">{{ title }}</h3>
        <p class="text-sm text-gray-400 mb-5">
          <slot>{{ description }}</slot>
        </p>
        <div class="flex justify-end gap-2">
          <button
            class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="px-4 py-2 text-sm rounded-lg"
            :class="confirmClass"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
