import { defineStore } from 'pinia';

interface UserLabFeature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  userEnabled: boolean;
}

export const useLabsStore = defineStore('labs', {
  state: () => ({
    features: [] as UserLabFeature[],
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
    async fetchFeatures() {
      try {
        const features = await $fetch<UserLabFeature[]>('/v1/user/labs', {
          credentials: 'include',
        });
        this.features = features;
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
