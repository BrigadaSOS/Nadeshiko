export const ankiStore = defineStore("anki", {
  state: () => ({
    ankiPreferences: {
      serverAddress: "http://127.0.0.1:8765",
      availableDecks: [],
      availableModels: [],
      settings: {
        current: {
          deck: null,
          model: null,
          fields: [],
        },
      },
    },
  }),
  persist: {
    key: "settings",
    storage: persistedState.localStorage,
    paths: ["ankiPreferences"],
  },
  actions: {
    async executeAction(action, params = {}) {
      try {
        const response = await fetch(this.ankiPreferences.serverAddress, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: action,
            params: params,
            version: 6,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${action}.`);
        }

        return await response.json();
      } catch (error) {
        console.error(`Error while requesting ${action}:`, error);
        throw error;
      }
    },

    async loadAnkiData() {
      try {
        let permission = await this.requestPermission();
        let decks = await this.getAllDeckNames();
        let models = await this.getAllModels();

        if (permission !== "granted") {
          throw new Error("Permission was denied.");
        }
        if (decks && Array.isArray(decks)) {
          this.ankiPreferences.availableDecks = decks;
        }
        if (models && Array.isArray(models)) {
          this.ankiPreferences.availableModels = models;
        }
      } catch (error) {
        throw new Error(`Failed to load Anki data: ${error.message}`);
      }
    },

    async requestPermission() {
      let response = await this.executeAction("requestPermission");
      return response.result.permission;
    },

    async getAllDeckNames() {
      let response = await this.executeAction("deckNames");
      return response.result;
    },

    async getAllModels() {
      let response = await this.executeAction("modelNames");
      return response.result;
    },

    async getAllModelFieldNames(modelName: string) {
      let response = await this.executeAction("modelFieldNames", {
        modelName: modelName,
      });
      return response;
    },
  },
});
