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
        const features = await $fetch<UserFeature[]>('/v1/user/labs', {
          credentials: 'include',
        });
        this.features = features;
        this.loaded = true;
      } catch (error) {
        console.error('[Labs] Failed to fetch features:', error);
      }
    },
    async toggleLab(key: string, enable: boolean) {
      const method = enable ? 'POST' : 'DELETE';
      await $fetch(`/v1/user/labs/${key}`, { method, credentials: 'include' });

      const feature = this.features.find((f) => f.key === key);
      if (feature) {
        feature.active = enable;
        feature.userOptedIn = enable;
      }
    },
  },
});
