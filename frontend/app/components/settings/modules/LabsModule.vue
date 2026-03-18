<script setup lang="ts">
import { useLabsStore } from '@/stores/labs';

const labsStore = useLabsStore();
const togglingKey = ref<string | null>(null);
const sdk = useNadeshikoSdk();

const { data: featuresData } = await useAsyncData(
  'settings-labs-features',
  async () => {
    const { data } = await sdk.listUserLabs().catch(() => ({ data: null }));
    return (data ?? []) as typeof labsStore.features;
  },
  {
    default: () => [],
  },
);

labsStore.features = featuresData.value;
labsStore.loaded = true;

const toggleFeature = async (key: string, currentActive: boolean) => {
  if (togglingKey.value) return;
  togglingKey.value = key;

  try {
    await labsStore.toggleLab(key, !currentActive);
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
    </div>
    <p class="text-gray-400 text-sm mt-1">
      Try experimental features before they are released to everyone!
    </p>
    <p class="text-gray-400 text-sm mt-3">
      These features are still under testing and might change at any time, but we would love to hear your feedback to help us improve them before they become default features in Nadeshiko.
    </p>
    <div class="border-b pt-4 border-white/10" />

    <div v-if="labsStore.features.length === 0" class="mt-4 text-gray-400">
      No lab features available at this time.
    </div>

    <div v-else class="mt-4 space-y-4">
      <div
        v-for="feature in labsStore.features"
        :key="feature.key"
        class="flex items-center justify-between mt-4"
      >
        <div class="flex-1">
          <span class="text-white font-medium">{{ feature.name }}</span>
          <p class="text-gray-400 text-sm mt-1">{{ feature.description }}</p>
        </div>
        <button
          :disabled="togglingKey === feature.key"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            feature.active ? 'bg-red-400' : 'bg-gray-600',
          ]"
          @click="toggleFeature(feature.key, feature.active)"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              feature.active ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>
    </div>
  </div>
</template>
