<script setup lang="ts">
import { useLabsStore } from '@/stores/labs';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const labsStore = useLabsStore();
const togglingKey = ref<string | null>(null);
const sdk = useNadeshikoSdk();

const { data: featuresData, status } = await useAsyncData(
  'settings-labs-features',
  async () => {
    return await sdk.listUserLabs().catch((error: unknown) => {
      // The persisted feature list stays on screen (see `applyFeatures` below), so
      // a failed refresh degrades to stale data rather than an empty panel.
      handleApiError('labs:list-failed', error, { toastKey: false });
      return [] as typeof labsStore.features;
    });
  },
  {
    // Session-scoped: an SSR call would carry the shared API key instead of the
    // user's session, so it can only return the wrong data.
    server: false,
    default: () => [],
  },
);

const applyFeatures = (features: typeof labsStore.features) => {
  labsStore.features = features;
  labsStore.loaded = true;
};

// During hydration `server: false` defers the fetch to the client, so only
// publish once it resolved -- otherwise the empty default would wipe the
// persisted feature list until the response lands.
if (status.value === 'success') {
  applyFeatures(featuresData.value);
}
watch(featuresData, applyFeatures);

const toggleFeature = async (key: string, currentActive: boolean) => {
  if (togglingKey.value) return;
  togglingKey.value = key;

  try {
    await labsStore.toggleLab(key, !currentActive);
  } catch (error) {
    // The toggle springs back to its previous position with no explanation otherwise.
    handleApiError('labs:toggle-failed', error, {
      toastKey: 'accountSettings.labs.toggleError',
      context: { 'lab.key': key },
    });
  } finally {
    togglingKey.value = null;
  }
};
</script>

<template>
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
    <div class="flex items-center gap-2">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.labs.title') }}</h3>
    </div>
    <p class="text-gray-400 text-sm mt-1">
      {{ t('accountSettings.labs.description') }}
    </p>
    <p class="text-gray-400 text-sm mt-3">
      {{ t('accountSettings.labs.feedbackDescription') }}
    </p>
    <div class="border-b pt-4 border-white/10" />

    <div v-if="labsStore.features.length === 0" class="mt-4 text-gray-400">
      {{ t('accountSettings.labs.empty') }}
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
