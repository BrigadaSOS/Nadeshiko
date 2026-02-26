// Types
interface AnkiNote {
  cards: number[];
  fields: { [key: string]: any };
  mod: number;
  modelName: string;
  noteId: number;
  profile: string;
  tags: string[];
}

interface IAnkiState {
  availableDecks: string[];
  availableModels: string[];
}

interface IField {
  key: string;
  value: string;
}

export interface AnkiProfile {
  id: string;
  name: string;
  deck?: string;
  model?: string;
  fields: IField[];
  key?: string;
  serverAddress: string;
}

interface PermissionResponse {
  result: {
    permission: string;
    requireApiKey: boolean;
    version: number;
  };
  error: string;
}

interface DeckNamesResponse {
  result: string[];
  error: string;
}

interface ModelNamesResponse {
  result: string[];
  error: string;
}

interface ModelFieldNamesResponse {
  result: string[];
  error: string;
}

interface GuiBrowseResponse {
  result: number[];
  error: string;
}

interface FindNotesResponse {
  result: number[];
  error: string;
}

interface NotesInfoResponse {
  result: AnkiNote[];
  error: string;
}

interface CollectionResponse {
  id: number;
  name: string;
}

type CollectionListResponse = {
  collections: CollectionResponse[];
  pagination: { hasMore: boolean; cursor: number | null };
};

import type { SearchResult } from '~/types/search';
import { defineStore } from 'pinia';
import { userStore } from '@/stores/auth';

const DEFAULT_ANKI_EXPORTS_COLLECTION = 'Anki Exports';
const DEFAULT_SERVER_ADDRESS = 'http://127.0.0.1:8765';

function createDefaultProfile(name = 'Default'): AnkiProfile {
  return {
    id: crypto.randomUUID(),
    name,
    deck: undefined,
    model: undefined,
    fields: [],
    key: undefined,
    serverAddress: DEFAULT_SERVER_ADDRESS,
  };
}

export const ankiStore = defineStore('anki', {
  state: (): IAnkiState => ({
    availableDecks: [],
    availableModels: [],
  }),
  getters: {
    profiles(): AnkiProfile[] {
      return userStore().preferences?.ankiProfiles ?? [];
    },
    activeProfile(): AnkiProfile | null {
      if (!import.meta.client) return null;
      const profiles = this.profiles;
      if (profiles.length === 0) return null;
      const activeId = localStorage.getItem('anki-active-profile');
      if (activeId) {
        const found = profiles.find((p: AnkiProfile) => p.id === activeId);
        if (found) return found;
      }
      return profiles[0] ?? null;
    },
  },
  actions: {
    async saveProfiles(profiles: AnkiProfile[]) {
      const store = userStore();
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({
        body: { ankiProfiles: profiles },
      });
      store.preferences = { ...store.preferences, ankiProfiles: profiles };
    },

    async createProfile(name: string): Promise<AnkiProfile> {
      const profile = createDefaultProfile(name);
      const updated = [...this.profiles, profile];
      await this.saveProfiles(updated);
      return profile;
    },

    async updateActiveProfile(data: Partial<AnkiProfile>) {
      const active = this.activeProfile;
      if (!active) return;
      const updated = this.profiles.map((p: AnkiProfile) => (p.id === active.id ? { ...p, ...data } : p));
      await this.saveProfiles(updated);
    },

    async deleteProfile(id: string) {
      const updated = this.profiles.filter((p: AnkiProfile) => p.id !== id);
      await this.saveProfiles(updated);
      if (import.meta.client) {
        const activeId = localStorage.getItem('anki-active-profile');
        if (activeId === id) {
          if (updated.length > 0 && updated[0]) {
            localStorage.setItem('anki-active-profile', updated[0].id);
          } else {
            localStorage.removeItem('anki-active-profile');
          }
        }
      }
    },

    setActiveProfileId(id: string) {
      if (!import.meta.client) return;
      localStorage.setItem('anki-active-profile', id);
    },

    async executeAction(action: string, params = {}) {
      if (!import.meta.client) return null;
      const serverAddress = this.activeProfile?.serverAddress ?? DEFAULT_SERVER_ADDRESS;
      try {
        const response = await fetch(serverAddress, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
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
      }
    },

    async loadAnkiData() {
      if (!import.meta.client) return;
      try {
        const permission = await this.requestPermission();
        const decks = await this.getAllDeckNames();
        const models = await this.getAllModels();

        if (permission && permission !== 'granted') {
          console.log('Permission was denied.');
        }
        if (decks && Array.isArray(decks)) {
          this.availableDecks = decks;
        }
        if (models && Array.isArray(models)) {
          this.availableModels = models;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load Anki data: ${message}`);
      }
    },

    async requestPermission(): Promise<string | null> {
      const response = (await this.executeAction('requestPermission')) as PermissionResponse;
      return response?.result?.permission ?? null;
    },

    async getAllDeckNames(): Promise<string[]> {
      const response = (await this.executeAction('deckNames')) as DeckNamesResponse;
      return response.result;
    },

    async getAllModels(): Promise<string[]> {
      const response = (await this.executeAction('modelNames')) as ModelNamesResponse;
      return response.result;
    },

    async getAllModelFieldNames(modelName: string): Promise<string[]> {
      const response = (await this.executeAction('modelFieldNames', {
        modelName: modelName,
      })) as ModelFieldNamesResponse;

      return response.result;
    },

    async getNotesWithCurrentKey(query: string, n: number = 5): Promise<Array<{ noteId: number; value: string }>> {
      if (!import.meta.client) return [];

      try {
        const currentKey = this.activeProfile?.key ?? '';

        const response = (await this.executeAction('findNotes', { query: query })) as FindNotesResponse;

        if (response.result && response.result.length === 0) {
          return [];
        }

        const notesRes = (await this.executeAction('notesInfo', {
          notes: response.result.slice(0, n),
        })) as NotesInfoResponse;

        const notesInfo = notesRes.result.map((note) => {
          if (!note.fields[currentKey]) {
            return { noteId: note.noteId, value: 'None' };
          }
          return { noteId: note.noteId, value: note.fields[currentKey].value };
        });

        return notesInfo;
      } catch (error) {
        console.error('Error while fetching notes:', error);
      }

      return [];
    },

    async getOrCreateAnkiExportsCollectionId(): Promise<number | null> {
      if (!import.meta.client) return null;

      try {
        const sdk = useNadeshikoSdk();
        const { data: listData } = await sdk.listCollections({ query: { take: 100 } });

        const existing = (listData?.collections ?? []).find(
          (collection) => collection.name === DEFAULT_ANKI_EXPORTS_COLLECTION,
        );
        if (existing) return existing.id;

        const { data: created } = await sdk.createCollection({
          body: {
            name: DEFAULT_ANKI_EXPORTS_COLLECTION,
            visibility: 'PRIVATE',
          },
        });

        return created?.id ?? null;
      } catch {
        return null;
      }
    },

    async addSegmentToAnkiExportsCollection(sentence: SearchResult): Promise<void> {
      if (!import.meta.client) return;
      if (!userStore().isLoggedIn) return;

      try {
        const collectionId = await this.getOrCreateAnkiExportsCollectionId();
        if (!collectionId) return;

        const sdk = useNadeshikoSdk();
        await sdk.addSegmentToCollection({
          path: { id: collectionId },
          body: { segmentUuid: sentence.segment.uuid },
        });
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode !== 409) {
          console.warn('[Anki] Could not sync segment to Anki Exports collection', {
            segmentUuid: sentence.segment.uuid,
            error,
          });
        }
      }
    },

    async addSentenceToAnki(sentence: SearchResult, id?: number) {
      await this.addResultToAnki(sentence, id);
    },

    async addResultToAnki(sentence: SearchResult, id?: number) {
      if (!import.meta.client) return;
      const { $i18n } = useNuxtApp();
      const { mediaName } = useMediaName();

      const profile = this.activeProfile;
      if (!profile) {
        useToastError($i18n.t('anki.toast.noSettings'));
        return;
      }

      try {
        useToastInfo($i18n.t('anki.toast.miningCard'));

        let cardID = id;

        if (!id) {
          const queryParts = [];
          let queryString = '';
          queryParts.push(`"deck:${profile.deck}"`);
          queryParts.push(`"note:${profile.model}"`);
          queryParts.push('added:2 is:new');
          queryString = queryParts.join(' ');

          const response = (await this.executeAction('findNotes', { query: queryString })) as FindNotesResponse;
          const noteIDs = response.result;

          const latestCard = noteIDs.reduce((a: number, b: number) => Math.max(a, b), -1);

          if (!latestCard || latestCard === -1) {
            useToastError($i18n.t('anki.toast.noCardToExport'));
            return;
          }

          cardID = latestCard;
        }

        const infoResponse = await this.executeAction('notesInfo', { notes: [cardID] });
        const infoCard = infoResponse.result;
        const imageRequest = this.executeAction('storeMediaFile', {
          filename: `${sentence.segment.uuid}.webp`,
          url: sentence.segment.urls.imageUrl,
        });

        let audioRequest;
        if (sentence.blobAudioUrl && sentence.blobAudio) {
          const blob64 = await blobToBase64(sentence.blobAudio);
          const raw = blob64.substring(blob64.indexOf(',') + 1);

          audioRequest = this.executeAction('storeMediaFile', {
            filename: `${sentence.segment.uuid}.wav`,
            data: raw,
          });
        } else {
          audioRequest = this.executeAction('storeMediaFile', {
            filename: `${sentence.segment.uuid}.mp3`,
            url: sentence.segment.urls.audioUrl,
          });
        }

        const [imageResult, audioResult] = await Promise.all([imageRequest, audioRequest]);

        await this.guiBrowse('nid:1 nid:2');

        const allowedFields = [
          'sentence-jp',
          'content_jp_highlight',
          'sentence-es',
          'sentence-en',
          'image',
          'sentence-audio',
          'sentence-info',
          'empty',
        ];
        const fieldsNew: Record<string, string> = {};

        profile.fields.forEach((field) => {
          if (field.value) {
            const regex = new RegExp(`\\{(${allowedFields.join('|')})\\}`);
            const match = field.value.match(regex);

            if (match) {
              const key = match[1];

              switch (key) {
                case 'empty':
                  fieldsNew[field.key] = field.value.replace(`{${key}}`, '');
                  break;
                case 'sentence-jp':
                  fieldsNew[field.key] = field.value.replace(
                    `{${key}}`,
                    `<div>${sentence.segment.textJa.content}</div>`,
                  );
                  break;
                case 'sentence-es':
                  fieldsNew[field.key] = field.value.replace(
                    `{${key}}`,
                    `<div>${sentence.segment.textEs.content ?? ''}</div>`,
                  );
                  break;
                case 'sentence-en':
                  fieldsNew[field.key] = field.value.replace(
                    `{${key}}`,
                    `<div>${sentence.segment.textEn.content ?? ''}</div>`,
                  );
                  break;
                case 'image':
                  fieldsNew[field.key] = field.value.replace(`{${key}}`, `<img src="${imageResult.result}">`);
                  break;
                case 'sentence-audio':
                  fieldsNew[field.key] = field.value.replace(`{${key}}`, `[sound:${audioResult.result}]`);
                  break;
                case 'sentence-info':
                  fieldsNew[field.key] = field.value.replace(
                    `{${key}}`,
                    `${mediaName(sentence.media)}・Episode ${sentence.segment.episode}, Timestamp: ${formatMs(sentence.segment.startTimeMs)}`,
                  );
                  break;
              }
            }
          }
        });

        const noteInfo = infoCard[0];
        if (!noteInfo) {
          useToastError($i18n.t('anki.toast.cardAddError', { error: 'No note info found' }));
          return;
        }

        await this.executeAction('updateNoteFields', {
          note: {
            fields: fieldsNew,
            id: noteInfo.noteId,
          },
        });

        await this.guiBrowse(`nid:${noteInfo.noteId}`);
        await this.addSegmentToAnkiExportsCollection(sentence);

        useToastSuccess($i18n.t('anki.toast.cardAdded'));
      } catch (error) {
        console.error(error);
        useToastError($i18n.t('anki.toast.cardAddError', { error: error }));
      }
    },

    async guiBrowse(query: string): Promise<number[]> {
      const response = (await this.executeAction('guiBrowse', { query: query })) as GuiBrowseResponse;
      return response.result;
    },

    async migrateFromLocalStorage() {
      if (!import.meta.client) return;
      if (!userStore().isLoggedIn) return;
      if (localStorage.getItem('anki-migrated')) return;

      // If server already has profiles, skip migration
      if (this.profiles.length > 0) {
        localStorage.setItem('anki-migrated', 'true');
        localStorage.removeItem('settings');
        return;
      }

      try {
        const raw = localStorage.getItem('settings');
        if (!raw) {
          localStorage.setItem('anki-migrated', 'true');
          return;
        }

        const parsed = JSON.parse(raw);
        const oldPrefs = parsed?.ankiPreferences;
        if (!oldPrefs) {
          localStorage.setItem('anki-migrated', 'true');
          return;
        }

        const profile: AnkiProfile = {
          id: crypto.randomUUID(),
          name: 'Default',
          deck: oldPrefs.settings?.current?.deck ?? undefined,
          model: oldPrefs.settings?.current?.model ?? undefined,
          fields: oldPrefs.settings?.current?.fields ?? [],
          key: oldPrefs.settings?.current?.key ?? undefined,
          serverAddress: oldPrefs.serverAddress ?? DEFAULT_SERVER_ADDRESS,
        };

        await this.saveProfiles([profile]);
        localStorage.setItem('anki-active-profile', profile.id);
        localStorage.setItem('anki-migrated', 'true');
        localStorage.removeItem('settings');
      } catch (error) {
        console.error('[Anki] Migration from localStorage failed:', error);
      }
    },
  },
});

// util functions

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
