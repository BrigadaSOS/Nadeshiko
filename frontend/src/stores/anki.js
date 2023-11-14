import { defineStore } from 'pinia'
import router from '../router/index'
import { useToast } from 'vue-toastification'
import { i18n } from '../main'

const toast = useToast()

const options = {
    timeout: 3000,
    position: 'bottom-right'
}

export const ankiStore = defineStore('anki', {
    state: () => ({
        ankiPreferences: {
            serverAddress: 'http://127.0.0.1:8765',
            availableDecks: [],
            availableModels: [],
            settings: {
                current: {
                    deck: null,
                    fields: {}
                }
            }
        },
    }),
    persist: {
        key: 'settings',
        storage: window.localStorage,
        paths: ['ankiPreferences']
    },
    actions: {
        async loadAnkiData() {
            let permission = await this.requestPermission();
            let decks = await this.getAllDeckNames();
            let models = await this.getAllModels();

            if (permission !== 'granted') {
                throw new Error('Permission was denied.');
            }

            if (decks && Array.isArray(decks)) {
                this.ankiPreferences.availableDecks = decks;
            }

            if (models && Array.isArray(models)) {
                this.ankiPreferences.availableModels = models;
            }

        },
        async requestPermission() {
            try {

                const response = await fetch(this.ankiPreferences.serverAddress, {
                    method: 'POST',
                    mode: 'cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'requestPermission',
                        version: 6
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch permission.');
                }

                const responseData = await response.json();
                return responseData.result.permission;

            } catch (error) {
                console.error("Error while requesting permission:", error);
                throw error;
            }
        },
        async getAllDeckNames() {
            try {

                const response = await fetch(this.ankiPreferences.serverAddress, {
                    method: 'POST',
                    mode: 'cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'deckNames',
                        version: 6
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch decks.');
                }

                const responseData = await response.json();
                return responseData.result;  

            } catch (error) {
                console.error("Error while requesting deck names:", error);
                throw error;
            }
        },
        async getAllModels() {
            try {

                const response = await fetch(this.ankiPreferences.serverAddress, {
                    method: 'POST',
                    mode: 'cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'modelNames',
                        version: 6
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch models.');
                }

                const responseData = await response.json();
                return responseData.result;

            } catch (error) {
                console.error("Error while requesting models:", error);
                throw error;
            }
        },
        async getAllModelFieldNames(modelName) {
            try {

                const response = await fetch(this.ankiPreferences.serverAddress, {
                    method: 'POST',
                    mode: 'cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'modelFieldNames',
                        params: {
                            modelName: modelName
                        },
                        version: 6
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch model field names.');
                }

                const responseData = await response.json();
                return responseData;

            } catch (error) {
                console.error("Error while requesting model field names:", error);
                throw error;
            }
        },
    }
})