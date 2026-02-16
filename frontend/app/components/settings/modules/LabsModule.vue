<script setup lang="ts">
import { useLabsStore } from '@/stores/labs';

const labsStore = useLabsStore();
const togglingKey = ref<string | null>(null);

// Fetch features on mount if not loaded
onMounted(async () => {
  if (!labsStore.loaded) {
    // Fetch user preferences to get opt-in state
    try {
      const prefs = await $fetch<{ labs?: Record<string, boolean> }>('/v1/user/preferences', {
        credentials: 'include',
      });
      await labsStore.fetchFeatures(prefs?.labs);
    } catch {
      await labsStore.fetchFeatures();
    }
  }
});

const toggleFeature = async (key: string, currentEnabled: boolean) => {
  if (togglingKey.value) return;
  togglingKey.value = key;

  const newValue = !currentEnabled;
  try {
    await $fetch('/v1/user/preferences', {
      method: 'PATCH',
      credentials: 'include',
      body: { labs: { [key]: newValue } },
    });
    labsStore.updateUserOptIn(key, newValue);
  } catch (error) {
    console.error('[Labs] Failed to toggle feature:', error);
  } finally {
    togglingKey.value = null;
  }
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
    <div class="flex items-center gap-2">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">Nadeshiko Labs</h3>
      <span class="inline-flex items-center rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">Beta</span>
    </div>
    <p class="text-gray-400 text-sm mt-1">Try experimental features before they're released to everyone.</p>
    <div class="border-b pt-4 border-white/10" />

    <div v-if="labsStore.features.length === 0" class="mt-4 text-gray-400">
      No lab features available at this time.
    </div>

    <div v-else class="mt-4 space-y-4">
      <div
        v-for="feature in labsStore.features"
        :key="feature.key"
        class="flex items-center justify-between p-4 rounded-lg bg-white/5"
      >
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="text-white font-medium">{{ feature.name }}</span>
            <span class="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
              Beta
            </span>
          </div>
          <p class="text-gray-400 text-sm mt-1">{{ feature.description }}</p>
          <p v-if="!feature.enabled" class="text-yellow-400/80 text-xs mt-1">
            This feature is currently unavailable.
          </p>
        </div>
        <button
          :disabled="!feature.enabled || togglingKey === feature.key"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            feature.userEnabled && feature.enabled ? 'bg-purple-600' : 'bg-gray-600',
            !feature.enabled ? 'opacity-50 cursor-not-allowed' : '',
          ]"
          @click="toggleFeature(feature.key, feature.userEnabled)"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              feature.userEnabled && feature.enabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>
    </div>
  </div>
</template>
