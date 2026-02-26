import { defineStore } from 'pinia';

interface UserFeature {
  key: string;
  name?: string;
  description?: string;
  active: boolean;
  userControllable: boolean;
  userOptedIn?: boolean;
}

export const useLabsStore = defineStore('labs', {
  state: () => ({
    features: [] as UserFeature[],
    loaded: false,
  }),
  getters: {
    isFeatureEnabled: (state) => (key: string) => {
      const feature = state.features.find((f) => f.key === key);
      return feature?.active ?? false;
    },
    labFeatures: (state) => state.features.filter((f) => f.userControllable),
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
        const { data } = await sdk.listUserLabs();
        this.features = (data ?? []) as UserFeature[];
        this.loaded = true;
      } catch (error) {
        console.error('[Labs] Failed to fetch features:', error);
      }
    },
    async toggleLab(key: string, enable: boolean) {
      const sdk = useNadeshikoSdk();
      if (enable) {
        await sdk.enrollUserLab({ path: { key } });
      } else {
        await sdk.unenrollUserLab({ path: { key } });
      }

      const feature = this.features.find((f) => f.key === key);
      if (feature) {
        feature.active = enable;
        feature.userOptedIn = enable;
      }
    },
  },
});
