import { firstNonBlank } from '~/utils/strings';

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
  /**
   * Whether AnkiConnect answered the last time anything asked it.
   *
   * `null` until something has, which is NOT the same as `false`: a reader who
   * has not opened a word card yet has no answer either way, and a control that
   * called that "Anki is not running" would be guessing. Set from
   * `executeAction`, the one place that finds out, so every caller shares one
   * answer instead of each discovering it separately.
   */
  connectReachable: boolean | null;
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
import type { MinedWord } from '~/utils/ankiWord';
import { deckNotesQuery, mostCommonModel } from '~/utils/ankiMining';
import { defineStore } from 'pinia';
import { tokensToAnkiFurigana } from '~/utils/tokenEnrichment';
import { userStore } from '@/stores/auth';
import { handleApiError } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import { buildSentencePath } from '~/utils/routes';

/**
 * How many of a deck's newest notes are read to decide its usual note type.
 *
 * Large enough that a handful of strays cannot outvote the real answer, small
 * enough that the `notesInfo` reply stays a reasonable size -- it carries every
 * field of every note asked for, which on a mining deck means the full card HTML.
 */
const MODEL_SAMPLE_SIZE = 100;

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
    connectReachable: null,
  }),
  getters: {
    profiles(): AnkiProfile[] {
      // Anki profiles are app-owned data kept inside user preferences. The generated schema
      // still describes a subset of what this store writes (`fields` is optional there and
      // required here), so narrow to the local shape. `openBrowserOnExport` used to be
      // missing from it too, which meant the server dropped the field on every save and
      // turning the setting off silently did nothing; it is declared now.
      return (userStore().preferences?.ankiProfiles ?? []) as AnkiProfile[];
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

    /**
     * One AnkiConnect call.
     *
     * `silent` suppresses the error report, and exists for the calls the reader
     * did not ask for. Everything here used to be one of those the reader DID
     * ask for -- an export, a settings probe -- so an unreachable Anki was worth
     * filing. The word card breaks that: it asks whether a word is already mined
     * every time one opens, and Anki being closed is the ordinary state for most
     * readers, so reporting it would file an exception per word looked up and
     * say nothing that a rate of successful exports does not already say.
     */
    async executeAction(action: string, params = {}, options: { silent?: boolean } = {}) {
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

        // Recorded on the way through rather than probed for. Anki running is
        // exactly "the last call reached it", and the word card already asks on
        // every open, so the controls get a live answer at no extra request.
        this.connectReachable = true;
        return await response.json();
      } catch (error) {
        this.connectReachable = false;
        if (!options.silent) reportError('anki:connect-request-failed', error, { 'anki.action': action });
        // AnkiConnect is unreachable (Anki closed, add-on disabled, CORS refused).
        // Returning null explicitly -- every caller must treat this as "no answer"
        // rather than dereferencing `.result` off undefined.
        return null;
      }
    },

    async loadAnkiData() {
      if (!import.meta.client) return;
      try {
        const permission = await this.requestPermission();
        if (permission === null) {
          throw new Error('AnkiConnect did not respond. Is Anki running with the AnkiConnect add-on enabled?');
        }

        const decks = await this.getAllDeckNames();
        const models = await this.getAllModels();

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
      const response = (await this.executeAction('requestPermission')) as PermissionResponse | null;
      return response?.result?.permission ?? null;
    },

    async getAllDeckNames(): Promise<string[]> {
      const response = (await this.executeAction('deckNames')) as DeckNamesResponse | null;
      return response?.result ?? [];
    },

    async getAllModels(): Promise<string[]> {
      const response = (await this.executeAction('modelNames')) as ModelNamesResponse | null;
      return response?.result ?? [];
    },

    async getAllModelFieldNames(modelName: string): Promise<string[]> {
      const response = (await this.executeAction('modelFieldNames', {
        modelName: modelName,
      })) as ModelFieldNamesResponse | null;

      return response?.result ?? [];
    },

    async getNotesWithCurrentKey(query: string, n: number = 5): Promise<Array<{ noteId: number; value: string }>> {
      if (!import.meta.client) return [];

      try {
        const currentKey = this.activeProfile?.key ?? '';

        const response = (await this.executeAction('findNotes', { query: query })) as FindNotesResponse | null;

        if (!response?.result?.length) {
          return [];
        }

        const notesRes = (await this.executeAction('notesInfo', {
          notes: response.result.slice(0, n),
        })) as NotesInfoResponse | null;

        const notesInfo = (notesRes?.result ?? []).map((note) => {
          if (!note.fields[currentKey]) {
            return { noteId: note.noteId, value: 'None' };
          }
          return { noteId: note.noteId, value: note.fields[currentKey].value };
        });

        return notesInfo;
      } catch (error) {
        reportError('anki:fetch-notes-failed', error);
      }

      return [];
    },

    /**
     * The note type a deck is mostly made of, for prefilling the picker.
     *
     * A deck can hold notes of any number of types, so there is no such thing as
     * "the deck's note type" -- but in practice a mining deck is one type with a
     * handful of strays, and making the reader name it themselves is a step that
     * only ever has one sensible answer. A suggestion, not a rule: the picker
     * stays a picker.
     *
     * Sampled from the MOST RECENT notes rather than the whole deck, and both
     * halves of that matter. Recent, because a deck that was reorganised months
     * ago should be answered by what the reader adds now, not by whatever they
     * imported in 2019. Sampled, because `notesInfo` returns every field of
     * every note it is asked about -- on a 40k-note deck that is megabytes of
     * card HTML crossing the wire to count a string.
     *
     * Returns null rather than throwing on any failure. This runs while the
     * reader is picking a deck, and a suggestion that cannot be made is not an
     * error worth interrupting them for -- they were going to choose anyway.
     */
    async mostCommonModelInDeck(deck: string): Promise<string | null> {
      if (!import.meta.client || !deck) return null;

      try {
        const query = deckNotesQuery(deck);
        if (!query) return null;

        const found = (await this.executeAction('findNotes', { query })) as FindNotesResponse | null;

        const ids = found?.result ?? [];
        if (ids.length === 0) return null;

        // `findNotes` returns ids in creation order, so the tail is the newest.
        const sample = ids.slice(-MODEL_SAMPLE_SIZE);
        const notesRes = (await this.executeAction('notesInfo', { notes: sample })) as NotesInfoResponse | null;

        return mostCommonModel(notesRes?.result ?? []);
      } catch (error) {
        reportError('anki:deck-model-probe-failed', error, { 'anki.deck': deck });
        return null;
      }
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
      } catch (error) {
        // Best-effort bookkeeping alongside the export the user actually asked for.
        // The caller aborts the sync quietly; the Anki card itself still lands.
        handleApiError('anki:exports-collection-resolve-failed', error, { toastKey: false });
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
        // 409 means the segment is already in the collection -- the desired end state.
        const err = error as { statusCode?: number };
        if (err.statusCode !== 409) {
          handleApiError('anki:exports-collection-sync-failed', error, {
            toastKey: false,
            context: { 'segment.publicId': sentence.segment.publicId },
          });
        }
      }
    },

    /** The sentence-level entry points, which have no selected word to send.
     *  Kept positional so the two callers that predate `MinedWord` are untouched. */
    async addSentenceToAnki(sentence: SearchResult, id?: number, method?: string) {
      // The menu normally prevents this, but keep the feature safe if a stale
      // page or another caller reaches it after the key field was cleared.
      // Without a key, a sentence-level export has no reliable card identity.
      if (!this.activeProfile?.key?.trim()) {
        const { $i18n } = useNuxtApp();
        useToastError($i18n.t('anki.toast.keyFieldRequired'));
        return;
      }
      await this.addResultToAnki(sentence, { noteId: id, method });
    },

    /**
     * `method` names the surface the export came from, for telemetry only.
     *
     * It was derived from whether a note id was passed, which was the same
     * question while there were exactly two ways in -- the dropdown's "last
     * added card" and its note picker. The word card is a third, and it uses
     * BOTH paths depending on whether the word was already mined, so a derived
     * value would scatter its exports across the other two and leave no way to
     * tell whether the button is used at all. Callers that do not care keep the
     * old derivation.
     *
     * `word` is the open card's own content, and only the word card has one: the
     * sentence-level exports are reached from a dropdown that never asked which
     * word the sentence is about. Its absence is not a failure -- see the
     * `{word-*}` cases below for what a note gets in that case, which is
     * deliberately nothing rather than blanks.
     *
     * `create` says the collection was ASKED about this word and answered no, so
     * a new note is the right target. It is not "there was no note id": that is
     * also true when the profile has no expression field to search on, and the
     * question was never put. Creating on a guess would mean a duplicate note
     * for every word a reader mines twice, so the caller has to have asked.
     */
    async addResultToAnki(
      sentence: SearchResult,
      options: { noteId?: number; method?: string; word?: MinedWord; create?: boolean; wordFields?: boolean } = {},
    ) {
      const { noteId: id, method, word: minedWord } = options;
      /**
       * Whether the word's own fields are part of this write.
       *
       * False is "enrich the card I already have with this sentence": the reader
       * has a note whose definition they wrote, or Yomitan wrote, and they want
       * Nadeshiko's example on it without their glossary being replaced. The
       * marked sentence is deliberately NOT gated on this -- it is context about
       * the sentence, not a fact about the word.
       */
      const withWordFields = options.wordFields !== false;
      const creating = !id && options.create === true;
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
      // Falls through all three names in every branch, matching `useMediaName`:
      // media without a title in the preferred language would otherwise put an
      // empty name on the Anki card and store an empty one on the activity.
      const mediaName = (media: { nameEn: string; nameJa: string; nameRomaji: string }) => {
        if (mediaLang === 'JAPANESE') return firstNonBlank(media.nameJa, media.nameEn, media.nameRomaji) ?? '';
        if (mediaLang === 'ROMAJI') return firstNonBlank(media.nameRomaji, media.nameEn, media.nameJa) ?? '';
        return firstNonBlank(media.nameEn, media.nameRomaji, media.nameJa) ?? '';
      };

      // Resolved before the first `await`, and shared with every failure branch
      // below so they all carry the same dimensions as the success event.
      const posthog = usePostHog();
      const exportMethod = method ?? (id ? 'search_by_id' : 'last_card');

      // Every abandoned export reports why. The early returns below are ordinary
      // outcomes rather than throws, so they reached neither error tracking nor
      // `anki_export_failed`, and the most common one by far -- no freshly added
      // card waiting in Anki -- was invisible. `completed + failed` therefore fell
      // well short of the attempts, and the failure rate read as ~0.5% against
      // 8.7k exports, which is not a plausible number for a feature that needs a
      // desktop app running with AnkiConnect and a card already added.
      const trackExportFailed = (reason: string, extra: Record<string, unknown> = {}) => {
        posthog?.capture('anki_export_failed', {
          reason,
          media_id: sentence.media.publicId,
          export_method: exportMethod,
          ...extra,
        });
      };

      const profile = this.activeProfile;
      if (!profile) {
        trackExportFailed('no_profile');
        useToastError($i18n.t('anki.toast.noSettings'));
        return;
      }

      try {
        useToastInfo($i18n.t('anki.toast.miningCard'));

        let cardID = id;

        if (!id && !creating) {
          const queryParts = [];
          let queryString = '';
          queryParts.push(`"deck:${profile.deck}"`);
          queryParts.push(`"note:${profile.model}"`);
          queryParts.push('added:2 is:new');
          queryString = queryParts.join(' ');

          const response = (await this.executeAction('findNotes', { query: queryString })) as FindNotesResponse | null;
          const noteIDs = response?.result ?? [];

          const latestCard = noteIDs.reduce((a: number, b: number) => Math.max(a, b), -1);

          if (!latestCard || latestCard === -1) {
            const globalQuery = `"note:${profile.model}" added:2 is:new`;
            const globalResponse = (await this.executeAction('findNotes', {
              query: globalQuery,
            })) as FindNotesResponse | null;
            if (globalResponse?.result && globalResponse.result.length > 0) {
              trackExportFailed('card_in_other_deck');
              useToastError($i18n.t('anki.toast.cardFoundInOtherDeck', { deck: profile.deck }));
            } else {
              trackExportFailed('no_card_found');
              useToastError($i18n.t('anki.toast.noCardToExport'));
            }
            return;
          }

          cardID = latestCard;
        }

        // Skipped when creating: there is no note to read yet, and the only thing
        // this answer is used for is the id to write back to.
        let infoCard: AnkiNote[] = [];
        if (!creating) {
          const infoResponse = (await this.executeAction('notesInfo', { notes: [cardID] })) as NotesInfoResponse | null;
          if (!infoResponse?.result) {
            throw new Error('AnkiConnect did not respond. Is Anki running with the AnkiConnect add-on enabled?');
          }
          infoCard = infoResponse.result;
        }

        const needsImage = profile.fields.some((f) => f.value?.includes('{image}'));
        const needsAudio = profile.fields.some((f) => f.value?.includes('{sentence-audio}'));
        // Both halves have to be true: the reader mapped a field to it, AND this
        // word has a recording. Coverage is per clip, so asking for one that was
        // never generated would spend a round trip to be told nothing.
        const needsWordAudio =
          withWordFields && profile.fields.some((f) => f.value?.includes('{word-audio}')) && !!minedWord?.audioUrl;

        let imageResult: any = null;
        let audioResult: any = null;
        let wordAudioResult: any = null;

        const mediaRequests: Promise<any>[] = [];

        // A failed still or clip must not abort the rest of the note: the
        // sentence text can still land, and a missing file is the same
        // situation as a field the reader never mapped.
        const ignoreMediaFailure = (error: unknown, kind: string) => {
          reportError(`anki:store-${kind}-failed`, error, { 'segment.publicId': sentence.segment.publicId });
        };

        if (needsImage) {
          const req = this.executeAction('storeMediaFile', {
            filename: `${sentence.segment.publicId}.webp`,
            url: sentence.segment.urls.imageUrl,
          }).then((r) => {
            imageResult = r;
          });
          mediaRequests.push(req.catch((error: unknown) => ignoreMediaFailure(error, 'image')));
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
            req
              .then((r) => {
                audioResult = r;
              })
              .catch((error: unknown) => ignoreMediaFailure(error, 'audio')),
          );
        }

        if (needsWordAudio && minedWord?.audioUrl && minedWord.audioFilename) {
          // By URL, like the still: the clip is on Shirabe's public CDN and
          // AnkiConnect fetches it itself, so nothing has to come through the
          // page and there is no CORS to satisfy.
          mediaRequests.push(
            this.executeAction('storeMediaFile', {
              filename: minedWord.audioFilename,
              url: minedWord.audioUrl,
            })
              .then((r) => {
                wordAudioResult = r;
              })
              .catch((error: unknown) => ignoreMediaFailure(error, 'word-audio')),
          );
        }

        await Promise.all(mediaRequests);

        if (profile.openBrowserOnExport !== false) {
          await this.guiBrowse('nid:1 nid:2');
        }

        // `word` last, after every `word-*` it is a prefix of. The closing brace
        // in the pattern below means backtracking would sort this out anyway --
        // `word` cannot be followed by `}` in `{word-reading}` -- but relying on
        // that puts the reader's reading field one regex tweak away from being
        // filled with the headword, and the order costs nothing.
        const allowedFields = [
          'sentence-jp',
          'content_jp_highlight',
          'sentence-es',
          'sentence-en',
          'sentence-audio',
          'sentence-info',
          'word-furigana',
          'word-reading',
          'word-audio',
          'word-pitch-num',
          'word-pitch',
          'word-info',
          'word-frequency',
          'word-jlpt',
          'word-pitch-categories',
          'sentence-furigana',
          'definition',
          'definition-first',
          'image',
          'empty',
          'word',
        ];
        const fieldsNew: Record<string, string> = {};

        /**
         * Which placeholders are facts about the WORD rather than the sentence.
         *
         * Two that read like word placeholders are deliberately not among them.
         * `{sentence-furigana}` is computed from the line's own tokens, and
         * `{content_jp_highlight}` marks which word was mined inside the
         * sentence -- both are context about the LINE, so both fill on the "add
         * context only" path that exists to leave a reader's own glossary alone.
         */
        const WORD_PLACEHOLDER =
          /^\{(?:definition|definition:[^}]+|definition-first|word|word-reading|word-furigana|word-audio|word-pitch|word-pitch-num|word-pitch-categories|word-frequency|word-jlpt|word-info)\}$/;

        /**
         * What one placeholder is worth on this export, or `undefined` for
         * "nothing to say".
         *
         * The distinction is the whole safety property of the feature, and it
         * predates composing. `undefined` means the field it sits in is left
         * exactly as it was, because a word-level placeholder is only ever
         * filled from the word card -- and the other two export paths (the
         * dropdown's "last added card" and the note picker) are reached without
         * a word having been selected at all. Writing a blank there would erase
         * the definition Yomitan put on the note, which is the one thing this
         * must not do to readers who already have a working setup. `{image}` and
         * `{sentence-audio}` follow the same discipline when an upload fails.
         *
         * An empty STRING is different: it is a deliberate clear. Only
         * `{definition:<slug>}` and `{empty}` return one.
         */
        const resolvePlaceholder = (token: string): string | undefined => {
          /**
           * `{definition:<slug>}` names ONE of the reader's dictionaries, so it
           * cannot join the fixed alternation below -- the slug is whatever
           * Shirabe calls that pack, including the content hash a Yomitan upload
           * is filed under. Tested first because a bare `{definition}` would
           * otherwise claim the prefix and write every dictionary into a field
           * that asked for one.
           *
           * Unlike every other word field, a miss CLEARS. The others are empty
           * when a feature is off, where blanking a field the reader filled
           * would be destructive; this one is empty when the open word is not in
           * that dictionary -- including when the reader ticked that dictionary
           * away in the card -- and leaving the previous export's text there
           * would put ANOTHER WORD's definition on this note.
           */
          const named = /^\{definition:([^}]+)\}$/.exec(token);
          if (named) {
            if (!withWordFields) return undefined;
            return minedWord?.definitionsByDictionary?.[named[1] as string] ?? '';
          }

          const key = token.slice(1, -1);
          /** A word-level value: absent unless the word card supplied one, and
           *  never written by the paths that have no word. */
          const word = (value: string | undefined) => (withWordFields ? value || undefined : undefined);

          switch (key) {
            case 'empty':
              return '';
            case 'sentence-jp':
              return `<div>${sentence.segment.textJa.content}</div>`;
            /*
             * The whole line's readings, in Anki's own notation. Yomitan cannot
             * produce this -- it knows the reading of the word the reader tapped
             * and nothing about the rest of the line -- which is why Lapis ships
             * `SentenceFurigana` empty and sends people to an addon for it.
             *
             * Beside `sentence-jp` rather than with the word fields, and NOT
             * gated on `withWordFields`: it is a fact about the sentence, so it
             * fills from the sentence card's own export as well as from the word
             * card, and survives the "keep my glossary" path that exists to
             * leave the word alone.
             */
            case 'sentence-furigana':
              return tokensToAnkiFurigana(sentence.segment.textJa.content, sentence.segment.textJa.tokens ?? []);
            case 'sentence-es': {
              const text = sentence.segment.textEs.content;
              return text ? `<div>${text}</div>` : undefined;
            }
            case 'sentence-en': {
              const text = sentence.segment.textEn.content;
              return text ? `<div>${text}</div>` : undefined;
            }
            case 'image':
              return imageResult?.result ? `<img src="${imageResult.result}">` : undefined;
            case 'sentence-audio':
              return audioResult?.result ? `[sound:${audioResult.result}]` : undefined;
            case 'word-audio':
              return wordAudioResult?.result ? `[sound:${wordAudioResult.result}]` : undefined;
            case 'sentence-info': {
              const isMovie = sentence.media.airingFormat === 'MOVIE';
              const episodePart = isMovie ? 'Movie' : `Episode ${sentence.segment.episode}`;
              const sentenceUrl = `${window.location.origin}${buildSentencePath(sentence.segment.publicId)}`;
              return (
                `<hr><small>${mediaName(sentence.media)}・${episodePart}, Timestamp: ${formatMs(sentence.segment.startTimeMs)}` +
                `<br><a href="${sentenceUrl}">View on Nadeshiko</a></small>`
              );
            }
            case 'word':
              return word(minedWord?.word);
            case 'word-reading':
              return word(minedWord?.reading);
            case 'word-furigana':
              return word(minedWord?.furigana);
            case 'definition':
              return word(minedWord?.definition);
            /**
             * The top dictionary of whatever the card is showing -- which a pick
             * narrows, so this follows a reader who ticked one dictionary rather
             * than going on naming the one they ticked away. Empty means
             * UNTOUCHED here, unlike `{definition:<slug>}` above: this field is
             * empty only when the lookup found nothing at all, which is the same
             * condition every other word field treats that way.
             */
            case 'definition-first':
              return word(minedWord?.definitionFirst);
            case 'word-pitch':
              return word(minedWord?.pitch);
            case 'word-pitch-num':
              return word(minedWord?.pitchPositions);
            case 'word-frequency':
              return word(minedWord?.frequency);
            case 'word-jlpt':
              return word(minedWord?.jlpt);
            case 'word-pitch-categories':
              return word(minedWord?.pitchCategories);
            case 'word-info':
              return word(minedWord?.info);
            /**
             * The sentence with the mined word marked.
             *
             * A placeholder that had been reserved in `allowedFields` since
             * before there was a word card to fill it: a field mapped to it
             * matched the regex, fell through the switch and was silently left
             * alone, so readers who found the name got nothing and no error. It
             * is a separate field from `{sentence-jp}` on purpose -- the plain
             * one keeps working exactly as it did, and nobody's existing cards
             * change shape because this arrived.
             */
            case 'content_jp_highlight':
              return minedWord?.sentenceHighlight || undefined;
            default:
              return undefined;
          }
        };

        /**
         * Every placeholder in a field, not just the first.
         *
         * `{definition:...}` leads the alternation for the reason above, and
         * `word` trails the `word-*` names it is a prefix of. The closing brace
         * means backtracking would sort the second one out anyway -- `word`
         * cannot be followed by `}` in `{word-reading}` -- but relying on that
         * puts the reader's reading field one regex tweak away from being filled
         * with the headword, and the order costs nothing.
         */
        const PLACEHOLDER = new RegExp(`\\{(?:definition:[^}]+|${allowedFields.join('|')})\\}`, 'g');

        /** Whether this export has word content to write at all: the word card
         *  supplied some, and the reader did not ask for the sentence alone. */
        const wordFieldsUsable = withWordFields && !!minedWord;

        profile.fields.forEach((field) => {
          if (!field.value) return;

          /**
           * A field is written when at least one of its placeholders had
           * something to say, and the ones that did not collapse to nothing.
           *
           * For a field holding a single placeholder -- which is every field
           * anybody had before composing existed -- this is exactly the old
           * behaviour: resolved writes, unresolved leaves it alone. For a
           * composite it is the useful generalisation: a word with no pitch
           * still gets its definition, rather than losing the whole field to one
           * absent part.
           */
          let resolvedAny = false;
          /**
           * ...with one exception that outranks it: a field that mentions the
           * word is written only when there IS a word to write.
           *
           * Two paths reach here without one -- the dropdown's "last added card"
           * and the note picker, neither of which selects a word -- and "add
           * context only" asks for the same restraint deliberately. A composite
           * mixing sentence and word placeholders would otherwise be written
           * with its word half blanked, which is the glossary-clobbering all
           * three exist to avoid: on a Yomitan-made note that half holds the
           * definition Yomitan wrote. One word-level placeholder is enough to
           * leave the whole field alone.
           *
           * A field holding only word placeholders lands in the same place by
           * either rule, since none of them would have resolved.
           */
          let blockedWordField = false;

          const next = field.value.replace(PLACEHOLDER, (token) => {
            if (!wordFieldsUsable && WORD_PLACEHOLDER.test(token)) {
              blockedWordField = true;
              return '';
            }
            const value = resolvePlaceholder(token);
            if (value === undefined) return '';
            resolvedAny = true;
            return value;
          });

          if (resolvedAny && !blockedWordField) fieldsNew[field.key] = next;
        });

        let writtenNoteId: number;

        if (creating) {
          /**
           * A word the reader has never mined gets a note of its own.
           *
           * Without this the only target was "the newest card added in the last
           * two days", which assumes something else -- Yomitan -- made the note
           * first. For a reader mining from Nadeshiko alone there is no such
           * card, so the export stopped with "add a card first"; and where there
           * WAS one it belonged to whatever word they last looked up elsewhere,
           * so mining a new word wrote this sentence, and now this word, over an
           * unrelated card.
           *
           * Only reached when the collection was actually asked and said no --
           * see `create` on the options. A profile that cannot answer the
           * question keeps the old fallback rather than guessing, because
           * guessing wrong here means a duplicate note every time.
           */
          const added = (await this.executeAction('addNote', {
            note: {
              deckName: profile.deck,
              modelName: profile.model,
              fields: fieldsNew,
              // Findable as a group later, and the thing that tells a reader
              // months from now where a card came from.
              tags: ['nadeshiko'],
              // Anki's own duplicate check, as a backstop to the probe. The two
              // can disagree -- the probe scopes to the profile's deck, Anki's
              // scopes to the note type -- and when they do, refusing is the
              // safe direction: a rejected create is a toast, a wrong one is a
              // duplicate the reader has to find and merge by hand.
              options: { allowDuplicate: false },
            },
          })) as { result?: number | null; error?: string | null } | null;

          if (!added?.result) {
            trackExportFailed('create_failed', { error_message: added?.error ?? 'addNote returned no id' });
            useToastError($i18n.t('anki.toast.cardAddError', { error: added?.error ?? 'could not create the note' }));
            return;
          }
          writtenNoteId = added.result;
        } else {
          const noteInfo = infoCard[0];
          if (!noteInfo) {
            trackExportFailed('no_note_info');
            useToastError($i18n.t('anki.toast.cardAddError', { error: 'No note info found' }));
            return;
          }

          await this.executeAction('updateNoteFields', {
            note: {
              fields: fieldsNew,
              id: noteInfo.noteId,
            },
          });
          writtenNoteId = noteInfo.noteId;
        }

        if (profile.openBrowserOnExport !== false) {
          await this.guiBrowse(`nid:${writtenNoteId}`);
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
            // Activity tracking is fire-and-forget telemetry: never let it interrupt
            // or warn about an export that already succeeded.
            .catch((error: unknown) => reportError('anki:track-export-activity-failed', error));
        }

        posthog?.capture('anki_export_completed', {
          media_id: sentence.media.publicId,
          export_method: exportMethod,
          // How many dictionaries the reader ticked, 0 on the overwhelming
          // majority of exports. Here to say whether picking is worth the row it
          // occupies on the card.
          picked_dictionaries: withWordFields ? (minedWord?.pickedDictionaries ?? 0) : 0,
        });

        useToastSuccess($i18n.t('anki.toast.cardAdded'));
      } catch (error) {
        reportError('anki:export-failed', error, { 'segment.publicId': sentence.segment.publicId });
        trackExportFailed('error');
        useToastError($i18n.t('anki.toast.cardAddError', { error: error }));
      }
    },

    async guiBrowse(query: string): Promise<number[]> {
      const response = (await this.executeAction('guiBrowse', { query: query })) as GuiBrowseResponse | null;
      return response?.result ?? [];
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
        reportError('anki:localstorage-migration-failed', error);
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
