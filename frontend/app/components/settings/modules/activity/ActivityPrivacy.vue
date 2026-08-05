<script setup lang="ts">
defineProps<{
  trackingEnabled: boolean;
  toggling: boolean;
  clearing: boolean;
}>();

const emit = defineEmits<{
  'toggle-tracking': [];
  'clear-history': [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.activity.privacy.title') }}</h3>

    <div class="mt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.trackingTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.trackingDescription') }}</p>
        </div>
        <button
          :disabled="toggling"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            trackingEnabled ? 'bg-red-500' : 'bg-gray-600',
          ]"
          @click="emit('toggle-tracking')"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              trackingEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ t('accountSettings.activity.privacy.clearHistoryTitle') }}</p>
          <p class="text-gray-400 text-sm">{{ t('accountSettings.activity.privacy.clearHistoryDescription') }}</p>
        </div>
        <button
          class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-1.5 px-3 rounded disabled:opacity-50"
          :disabled="clearing"
          @click="emit('clear-history')"
        >
          {{ clearing ? t('accountSettings.activity.privacy.clearing') : t('accountSettings.activity.privacy.clearHistoryButton') }}
        </button>
      </div>
    </div>
  </div>
</template>
