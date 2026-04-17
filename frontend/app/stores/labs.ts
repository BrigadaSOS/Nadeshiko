import { defineStore } from 'pinia';
import type { UserLabFeature } from '@brigadasos/nadeshiko-sdk';

export const useLabsStore = defineStore('labs', {
  state: () => ({
    features: [] as UserLabFeature[],
    loaded: false,
  }),
  getters: {
    isFeatureEnabled: (state) => (key: string) => {
      const feature = state.features.find((f) => f.key === key);
      return feature?.active ?? false;
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
        const sdk = useNadeshikoSdk();
        this.features = await sdk.listUserLabs();
        this.loaded = true;
      } catch (error) {
        console.error('[Labs] Failed to fetch features:', error);
      }
    },
    async toggleLab(key: string, enable: boolean) {
      const sdk = useNadeshikoSdk();
      if (enable) {
        await sdk.enrollUserLab(key);
      } else {
        await sdk.unenrollUserLab(key);
      }

      const feature = this.features.find((f) => f.key === key);
      if (feature) {
        feature.active = enable;
      }
    },
  },
});
