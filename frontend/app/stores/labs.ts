import { defineStore } from 'pinia';

interface LabFeature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
}

interface LabFeatureWithStatus extends LabFeature {
  userEnabled: boolean;
}

export const useLabsStore = defineStore('labs', {
  state: () => ({
    features: [] as LabFeatureWithStatus[],
    loaded: false,
  }),
  getters: {
    isFeatureEnabled: (state) => (key: string) => {
      const feature = state.features.find((f) => f.key === key);
      return feature ? feature.enabled && feature.userEnabled : false;
    },
  },
  persist: import.meta.client
    ? {
        key: 'labs',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['features'],
      }
    : false,
  actions: {
    async fetchFeatures(userPreferencesLabs?: Record<string, boolean>) {
      try {
        const features = await $fetch<LabFeature[]>('/v1/labs');
        this.features = features.map((f) => ({
          ...f,
          userEnabled: userPreferencesLabs?.[f.key] ?? false,
        }));
        this.loaded = true;
      } catch (error) {
        console.error('[Labs] Failed to fetch features:', error);
      }
    },
    updateUserOptIn(key: string, enabled: boolean) {
      const feature = this.features.find((f) => f.key === key);
      if (feature) {
        feature.userEnabled = enabled;
      }
    },
  },
});
