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
  activeProfileId: string | null;
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
  openBrowserOnExport?: boolean;
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

import type { SearchResult } from '~/types/search';
import { defineStore } from 'pinia';
import { userStore } from '@/stores/auth';
import { buildSentencePath, localizePath } from '~/utils/routes';

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
    activeProfileId: import.meta.client ? localStorage.getItem('anki-active-profile') : null,
  }),
  getters: {
    profiles(): AnkiProfile[] {
      return userStore().preferences?.ankiProfiles ?? [];
    },
    activeProfile(): AnkiProfile | null {
      const profiles = this.profiles;
      if (profiles.length === 0) return null;
      if (this.activeProfileId) {
        const found = profiles.find((p: AnkiProfile) => p.id === this.activeProfileId);
        if (found) return found;
      }
      return profiles[0] ?? null;
    },
  },
  actions: {
    async saveProfiles(profiles: AnkiProfile[]) {
      const store = userStore();
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({ ankiProfiles: profiles });
      store.preferences = { ...store.preferences, ankiProfiles: profiles };
      const posthog = usePostHog();
      posthog?.capture('anki_profile_configured', { profile_count: profiles.length });
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
      if (this.activeProfileId === id) {
        const newId = updated.length > 0 && updated[0] ? updated[0].id : null;
        this.activeProfileId = newId;
        if (import.meta.client) {
          if (newId) {
            localStorage.setItem('anki-active-profile', newId);
          } else {
            localStorage.removeItem('anki-active-profile');
          }
        }
      }
    },

    setActiveProfileId(id: string) {
      this.activeProfileId = id;
      if (import.meta.client) {
        localStorage.setItem('anki-active-profile', id);
      }
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
        const posthog = usePostHog();
        posthog?.capture('anki_connection_tested', {
          success: true,
          deck_count: this.availableDecks.length,
          model_count: this.availableModels.length,
        });
      } catch (error) {
        const posthog = usePostHog();
        posthog?.capture('anki_connection_tested', { success: false });
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

    async getOrCreateAnkiExportsCollectionId(): Promise<string | null> {
      if (!import.meta.client) return null;

      try {
        const sdk = useNadeshikoSdk();
        const listData = await sdk.listCollections({ take: 100 });
        const existing = listData.collections.find((collection) => collection.type === 'ANKI_EXPORT');
        if (existing) return existing.publicId;

        const created = await sdk.createCollection({
          name: DEFAULT_ANKI_EXPORTS_COLLECTION,
          visibility: 'PRIVATE',
        });

        return created.publicId;
      } catch {
        return null;
      }
    },

    async addSegmentToAnkiExportsCollection(sentence: SearchResult): Promise<void> {
      if (!import.meta.client) return;
      if (!userStore().isLoggedIn) return;

      try {
        const collectionPublicId = await this.getOrCreateAnkiExportsCollectionId();
        if (!collectionPublicId) return;

        const sdk = useNadeshikoSdk();
        await sdk.addSegmentToCollection({
          collectionPublicId,
          segmentPublicId: sentence.segment.publicId,
        });
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode !== 409) {
          console.warn('[Anki] Could not sync segment to Anki Exports collection', {
            segmentId: sentence.segment.publicId,
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
      const locale = $i18n.locale.value;
      const user = userStore();
      const mediaLang =
        user.isLoggedIn && user.preferences?.mediaNameLanguage
          ? user.preferences.mediaNameLanguage
          : locale === 'ja'
            ? 'JAPANESE'
            : 'ENGLISH';
      const mediaName = (media: { nameEn: string; nameJa: string; nameRomaji: string }) => {
        if (mediaLang === 'JAPANESE') return media.nameJa || media.nameEn;
        if (mediaLang === 'ROMAJI') return media.nameRomaji || media.nameEn;
        return media.nameEn;
      };

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
            const globalQuery = `"note:${profile.model}" added:2 is:new`;
            const globalResponse = (await this.executeAction('findNotes', { query: globalQuery })) as FindNotesResponse;
            if (globalResponse.result && globalResponse.result.length > 0) {
              useToastError($i18n.t('anki.toast.cardFoundInOtherDeck', { deck: profile.deck }));
            } else {
              useToastError($i18n.t('anki.toast.noCardToExport'));
            }
            return;
          }

          cardID = latestCard;
        }

        const infoResponse = await this.executeAction('notesInfo', { notes: [cardID] });
        const infoCard = infoResponse.result;

        const needsImage = profile.fields.some((f) => f.value?.includes('{image}'));
        const needsAudio = profile.fields.some((f) => f.value?.includes('{sentence-audio}'));

        let imageResult: any = null;
        let audioResult: any = null;

        const mediaRequests: Promise<any>[] = [];

        if (needsImage) {
          const req = this.executeAction('storeMediaFile', {
            filename: `${sentence.segment.publicId}.webp`,
            url: sentence.segment.urls.imageUrl,
          }).then((r) => {
            imageResult = r;
          });
          mediaRequests.push(req);
        }

        if (needsAudio) {
          let req;
          if (sentence.blobAudioUrl && sentence.blobAudio) {
            const blob64 = await blobToBase64(sentence.blobAudio);
            const raw = blob64.substring(blob64.indexOf(',') + 1);
            req = this.executeAction('storeMediaFile', {
              filename: `${sentence.segment.publicId}.wav`,
              data: raw,
            });
          } else {
            req = this.executeAction('storeMediaFile', {
              filename: `${sentence.segment.publicId}.mp3`,
              url: sentence.segment.urls.audioUrl,
            });
          }
          mediaRequests.push(
            req.then((r) => {
              audioResult = r;
            }),
          );
        }

        await Promise.all(mediaRequests);

        if (profile.openBrowserOnExport !== false) {
          await this.guiBrowse('nid:1 nid:2');
        }

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
                  if (imageResult?.result) {
                    fieldsNew[field.key] = field.value.replace(`{${key}}`, `<img src="${imageResult.result}">`);
                  }
                  break;
                case 'sentence-audio':
                  if (audioResult?.result) {
                    fieldsNew[field.key] = field.value.replace(`{${key}}`, `[sound:${audioResult.result}]`);
                  }
                  break;
                case 'sentence-info': {
                  const isMovie = sentence.media.airingFormat === 'MOVIE';
                  const episodePart = isMovie ? 'Movie' : `Episode ${sentence.segment.episode}`;
                  const sentenceUrl = `${window.location.origin}${localizePath(
                    window.location.pathname,
                    buildSentencePath(sentence.segment.publicId),
                  )}`;
                  const info =
                    `<hr><small>${mediaName(sentence.media)}・${episodePart}, Timestamp: ${formatMs(sentence.segment.startTimeMs)}` +
                    `<br><a href="${sentenceUrl}">View on Nadeshiko</a></small>`;
                  fieldsNew[field.key] = field.value.replace(`{${key}}`, info);
                  break;
                }
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

        if (profile.openBrowserOnExport !== false) {
          await this.guiBrowse(`nid:${noteInfo.noteId}`);
        }
        await this.addSegmentToAnkiExportsCollection(sentence);

        if (user.isLoggedIn) {
          const sdk = useNadeshikoSdk();
          sdk
            .trackUserActivity({
              activityType: 'ANKI_EXPORT',
              segmentPublicId: sentence.segment.publicId,
              mediaPublicId: sentence.media.publicId,
              mediaName: mediaName(sentence.media),
              japaneseText: sentence.segment.textJa.content,
            })
            .catch(() => {});
        }

        const posthog = usePostHog();
        posthog?.capture('anki_export_completed', {
          media_name: mediaName(sentence.media),
          media_id: sentence.media.publicId,
          export_method: id ? 'search_by_id' : 'last_card',
        });

        useToastSuccess($i18n.t('anki.toast.cardAdded'));
      } catch (error) {
        console.error(error);
        const posthog = usePostHog();
        posthog?.capture('anki_export_failed', {
          error_message: error instanceof Error ? error.message : String(error),
        });
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
