import { firstNonBlank } from '~/utils/strings';

interface AnkiNote {
  cards: number[];
  fields: { [key: string]: any };
  mod: number;
  modelName: string;
  noteId: number;
  profile: string;
  tags: string[];
}

/**
 * Closed failure labels shared by analytics and setup tips. Permission denial means Anki
 * answered; unreachable fetch failures cannot distinguish closed Anki, a missing add-on, CORS,
 * or extensions. Only a recorded CSP violation justifies blocked_by_csp.
 */
export const ANKI_CONNECT_FAILURES = [
  'unreachable',
  'blocked_by_csp',
  'permission_denied',
  'connect_error',
  'http_error',
  'no_decks',
] as const;

export type AnkiConnectFailure = (typeof ANKI_CONNECT_FAILURES)[number];

/**
 * Expected setup failures show the setup panel, not an application exception. Carry the reason
 * on the error because store state may already describe a later call.
 */
export class AnkiUnavailableError extends Error {
  readonly reason: AnkiConnectFailure;

  constructor(message: string, reason: AnkiConnectFailure) {
    super(message);
    this.name = 'AnkiUnavailableError';
    this.reason = reason;
  }
}

/** Match by name: duplicated bundles can have different class identities; see ~/utils/apiError. */
export function isAnkiUnavailable(error: unknown): error is AnkiUnavailableError {
  return (error as { name?: unknown } | null | undefined)?.name === 'AnkiUnavailableError';
}

interface IAnkiState {
  availableDecks: string[];
  availableModels: string[];
  activeProfileId: string | null;
  /**
   * Last observed reachability; null means untested, not offline. Updated by executeAction so
   * callers share one answer.
   */
  connectReachable: boolean | null;
  /**
   * Reachability does not imply export readiness: permission_denied and no_decks can occur
   * after Anki answers.
   */
  connectFailure: AnkiConnectFailure | null;
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
import { escapeHtml, type MinedWord } from '~/utils/ankiWord';
import { deckNotesQuery, mostCommonModel } from '~/utils/ankiMining';
import { defineStore } from 'pinia';
import { tokensToAnkiFurigana } from '~/utils/tokenEnrichment';
import { userStore } from '@/stores/auth';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { reportError, reportEvent } from '~/utils/reportError';
import { cspViolationLog, installCspViolationLog } from '~/utils/cspViolations';
import { classifyAnkiAddress } from '~/utils/ankiAddress';
import { buildSentencePath } from '~/utils/routes';

/** Sample enough recent notes to tolerate strays without fetching every note's full card HTML. */
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
    connectFailure: null,
  }),
  getters: {
    profiles(): AnkiProfile[] {
      // Narrow app-owned preferences to the local profile shape: the generated schema makes
      // fields optional.
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
     * Background word-card probes use silent to avoid reporting ordinary local setup failures;
     * CSP refusals remain reportable.
     */
    async executeAction(action: string, params = {}, options: { silent?: boolean } = {}) {
      if (!import.meta.client) return null;
      const serverAddress = this.activeProfile?.serverAddress ?? DEFAULT_SERVER_ADDRESS;
      // Install before fetch so violations emitted during failure are captured. Installation is
      // idempotent.
      installCspViolationLog();
      const startedAt = Date.now();
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
          this.connectFailure = 'http_error';
          throw new Error(`Failed to fetch ${action}.`);
        }

        // Recorded on the way through rather than probed for. Anki running is
        // exactly "the last call reached it", and the word card already asks on
        // every open, so the controls get a live answer at no extra request.
        this.connectReachable = true;

        const body = await response.json();

        // AnkiConnect can return HTTP 200 with {result: null, error}; record the failure before
        // handing the body to callers.
        if (body?.error) {
          this.connectFailure = 'connect_error';
        } else {
          this.connectFailure = null;
        }

        return body;
        // Fetch rejection details cannot distinguish local setup failures; classification below
        // uses the evidence available.
      } catch {
        this.connectReachable = false;
        // Yield once: fetch rejection and securitypolicyviolation are separate tasks with no
        // guaranteed dispatch order.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const refusedByPolicy = cspViolationLog.refusedSince(serverAddress, startedAt);
        // Preserve the more specific http_error; otherwise distinguish CSP refusal on evidence
        // and leave opaque fetch failures unreachable.
        if (this.connectFailure !== 'http_error') {
          this.connectFailure = refusedByPolicy ? 'blocked_by_csp' : 'unreachable';
        }
        // Count local setup failures rather than filing application exceptions. CSP refusals
        // are app-actionable and are counted even for silent probes.
        if (!options.silent || this.connectFailure === 'blocked_by_csp') {
          reportEvent('anki_connect_request_failed', {
            'anki.action': action,
            'anki.reason': this.connectFailure ?? 'unreachable',
            // Report only the address category, never the reader's address; see
            // utils/ankiAddress.
            'anki.address_kind': classifyAnkiAddress(serverAddress),
          });
        }
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
          // `connectFailure` is already whatever `executeAction` decided --
          // `unreachable`, `http_error` or `connect_error`. Left alone rather than
          // overwritten, because it is the more specific answer.
          throw new AnkiUnavailableError(
            'AnkiConnect did not respond. Is Anki running with the AnkiConnect add-on enabled?',
            this.connectFailure ?? 'unreachable',
          );
        }

        // Denied permission is not an empty deck list: Anki is running and the reader must
        // allow this origin.
        if (permission !== 'granted') {
          this.connectFailure = 'permission_denied';
          throw new AnkiUnavailableError(
            `AnkiConnect refused this site (permission: ${permission}).`,
            'permission_denied',
          );
        }

        // Check each lookup before the next call: a successful executeAction clears
        // connectFailure and would erase the cause.
        const decks = await this.getAllDeckNames();
        if (decks === null) throw this.stoppedAnswering();

        const models = await this.getAllModels();
        if (models === null) throw this.stoppedAnswering();

        // Publish decks and models only after both lookups succeed, preserving the existing
        // choices on connection failure.
        this.availableDecks = decks;
        this.availableModels = models;

        // Granted, reachable, and nothing to export into. Rare, but it is a
        // different fix from every other branch (make a deck) and it used to be
        // counted as a success that the reader could not act on.
        if (this.availableDecks.length === 0) {
          this.connectFailure = 'no_decks';
          throw new AnkiUnavailableError('AnkiConnect returned no decks.', 'no_decks');
        }

        this.connectFailure = null;
        const posthog = usePostHog();
        posthog?.capture('anki_connection_tested', {
          success: true,
          deck_count: this.availableDecks.length,
          model_count: this.availableModels.length,
        });
      } catch (error) {
        const posthog = usePostHog();

        posthog?.capture('anki_connection_tested', {
          success: false,
          reason: isAnkiUnavailable(error) ? error.reason : (this.connectFailure ?? 'unreachable'),
        });

        // Preserve AnkiUnavailableError so callers can distinguish setup failures from
        // application faults.
        if (isAnkiUnavailable(error)) throw error;

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load Anki data: ${message}`);
      }
    },

    /** The failure raised when Anki answered the permission probe and then went
     *  quiet. Carries whatever reason `executeAction` established rather than a
     *  guess, which is why callers must raise it before the next request. */
    stoppedAnswering(): AnkiUnavailableError {
      return new AnkiUnavailableError(
        'AnkiConnect stopped answering while loading decks and note types.',
        this.connectFailure ?? 'unreachable',
      );
    },

    async requestPermission(): Promise<string | null> {
      const response = (await this.executeAction('requestPermission')) as PermissionResponse | null;
      return response?.result?.permission ?? null;
    },

    /** The reader's decks, or `null` when Anki did not answer -- see
     *  `getAllModelFieldNames` for why the two must not look the same. An empty
     *  list is a real answer here and a meaningful one: it means make a deck. */
    async getAllDeckNames(): Promise<string[] | null> {
      const response = (await this.executeAction('deckNames')) as DeckNamesResponse | null;
      return response?.result ?? null;
    },

    /** The reader's note types, or `null` when Anki did not answer. */
    async getAllModels(): Promise<string[] | null> {
      const response = (await this.executeAction('modelNames')) as ModelNamesResponse | null;
      return response?.result ?? null;
    },

    /**
     * Return null for an unanswered or refused lookup, not []. An empty list would let AnkiSync
     * overwrite the saved field mapping.
     */
    async getAllModelFieldNames(modelName: string): Promise<string[] | null> {
      const response = (await this.executeAction('modelFieldNames', {
        modelName: modelName,
      })) as ModelFieldNamesResponse | null;

      return response?.result ?? null;
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
     * Suggest the most common type among recent notes, not the whole deck: notesInfo includes
     * full card HTML. Failure returns null so the reader can still choose manually.
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
        // Persisted login state may outlive its session. Only a 401 resets auth; network
        // failures, 5xx, and rate limits must not.
        const status = apiErrorStatus(error);
        if (status === 401) {
          userStore().resetAuthState();
          return null;
        }

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

    /**
     * Sentence exports remain positional and do not require a key field: the picker supplies an
     * id, and last-card lookup uses deck, note type, and recency.
     */
    async addSentenceToAnki(sentence: SearchResult, id?: number, method?: string) {
      await this.addResultToAnki(sentence, { noteId: id, method });
    },

    /**
     * method identifies the export surface for telemetry; absent values keep the note-id-based
     * fallback. word is supplied only by word cards. create requires a negative collection
     * probe, not merely an absent note id, to avoid duplicate notes.
     */
    async addResultToAnki(
      sentence: SearchResult,
      options: { noteId?: number; method?: string; word?: MinedWord; create?: boolean; wordFields?: boolean } = {},
    ) {
      const { noteId: id, method, word: minedWord } = options;
      /**
       * wordFields=false adds sentence context without replacing the reader's glossary.
       * Sentence highlighting is not gated by it.
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

      // Count ordinary early-return failures too, so attempted exports are not missing from the
      // failure rate.
      const trackExportFailed = (reason: string, extra: Record<string, unknown> = {}) => {
        posthog?.capture('anki_export_failed', {
          reason,
          media_name: mediaName(sentence.media),
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

          // No answer is not an empty search: null or result:null means Anki is unavailable,
          // while result:[] means no matching card.
          if (!response?.result) {
            const reason = this.connectFailure ?? 'unreachable';
            trackExportFailed('anki_unavailable', { 'anki.reason': reason });
            useToastError($i18n.t(`accountSettings.anki.connectFailure.${reason}.title`));
            return;
          }

          const noteIDs = response.result;

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

        // Keep word after the longer word-* alternatives to avoid prefix ambiguity if the
        // placeholder pattern changes.
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
         * Sentence furigana and highlighting are line context, not word fields, so they remain
         * eligible for context-only exports.
         */
        const WORD_PLACEHOLDER =
          /^\{(?:definition|definition:[^}]+|definition-first|word|word-reading|word-furigana|word-audio|word-pitch|word-pitch-num|word-pitch-categories|word-frequency|word-jlpt|word-info)\}$/;

        /**
         * undefined supplies no replacement; an empty string deliberately clears. Missing word
         * content or media uploads must not erase existing fields. Only named definitions and
         * {empty} explicitly clear.
         */
        const resolvePlaceholder = (token: string): string | undefined => {
          /**
           * Match dynamic dictionary slugs before fixed placeholders. A missing or deselected
           * named dictionary clears its definition to avoid retaining another word's text;
           * context-only exports leave it untouched.
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
          /** MinedWord's plain-text fields, which reach an HTML field unescaped otherwise. */
          const plain = (value: string | undefined) => (value === undefined ? undefined : escapeHtml(value));

          switch (key) {
            case 'empty':
              return '';
            // Anki renders fields as HTML, so plain corpus text and titles are escaped here; fields that
            // already carry markup (definitions, pitch, info, highlight) were escaped where they were built.
            case 'sentence-jp':
              return `<div>${escapeHtml(sentence.segment.textJa.content)}</div>`;
            /*
             * Sentence furigana comes from the line's tokens and is not gated by wordFields,
             * including on context-only exports.
             */
            case 'sentence-furigana':
              // Escape after: token offsets index the raw text, and the notation adds only brackets and spaces.
              return escapeHtml(
                tokensToAnkiFurigana(sentence.segment.textJa.content, sentence.segment.textJa.tokens ?? []),
              );
            case 'sentence-es': {
              const text = sentence.segment.textEs.content;
              return text ? `<div>${escapeHtml(text)}</div>` : undefined;
            }
            case 'sentence-en': {
              const text = sentence.segment.textEn.content;
              return text ? `<div>${escapeHtml(text)}</div>` : undefined;
            }
            case 'image':
              return imageResult?.result ? `<img src="${escapeHtml(imageResult.result)}">` : undefined;
            case 'sentence-audio':
              return audioResult?.result ? `[sound:${audioResult.result}]` : undefined;
            case 'word-audio':
              return wordAudioResult?.result ? `[sound:${wordAudioResult.result}]` : undefined;
            case 'sentence-info': {
              const isMovie = sentence.media.airingFormat === 'MOVIE';
              const episodePart = isMovie ? 'Movie' : `Episode ${sentence.segment.episode}`;
              const sentenceUrl = `${window.location.origin}${buildSentencePath(sentence.segment.publicId)}`;
              return (
                `<hr><small>${escapeHtml(mediaName(sentence.media))}・${episodePart}, Timestamp: ${formatMs(sentence.segment.startTimeMs)}` +
                `<br><a href="${escapeHtml(sentenceUrl)}">View on Nadeshiko</a></small>`
              );
            }
            case 'word':
              return word(plain(minedWord?.word));
            case 'word-reading':
              return word(plain(minedWord?.reading));
            case 'word-furigana':
              return word(plain(minedWord?.furigana));
            case 'definition':
              return word(minedWord?.definition);
            /**
             * Use the first definition from the selected dictionaries. Absent content leaves
             * the field untouched, unlike a missing named-dictionary definition.
             */
            case 'definition-first':
              return word(minedWord?.definitionFirst);
            case 'word-pitch':
              return word(minedWord?.pitch);
            case 'word-pitch-num':
              return word(plain(minedWord?.pitchPositions));
            case 'word-frequency':
              return word(plain(minedWord?.frequency));
            case 'word-jlpt':
              return word(plain(minedWord?.jlpt));
            case 'word-pitch-categories':
              return word(plain(minedWord?.pitchCategories));
            case 'word-info':
              return word(minedWord?.info);
            /**
             * Keep highlighting separate from sentence-jp so existing plain sentence mappings
             * retain their format.
             */
            case 'content_jp_highlight':
              return minedWord?.sentenceHighlight || undefined;
            default:
              return undefined;
          }
        };

        /**
         * Replace every placeholder. Dynamic definitions lead the alternation, and word follows
         * its longer word-* variants.
         */
        const PLACEHOLDER = new RegExp(`\\{(?:definition:[^}]+|${allowedFields.join('|')})\\}`, 'g');

        /** Whether this export has word content to write at all: the word card
         *  supplied some, and the reader did not ask for the sentence alone. */
        const wordFieldsUsable = withWordFields && !!minedWord;

        profile.fields.forEach((field) => {
          if (!field.value) return;

          /**
           * Write only if at least one placeholder resolves; unresolved parts become empty. A
           * wholly unresolved field stays untouched.
           */
          let resolvedAny = false;
          /**
           * Without usable word content, any word placeholder blocks the entire field,
           * including composites. Otherwise sentence-only exports could blank a Yomitan
           * glossary.
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
           * Create only after a negative probe; callers unable to check the collection keep the
           * last-card fallback rather than guessing.
           */
          const added = (await this.executeAction('addNote', {
            note: {
              deckName: profile.deck,
              modelName: profile.model,
              fields: fieldsNew,
              // Findable as a group later, and the thing that tells a reader
              // months from now where a card came from.
              tags: ['nadeshiko'],
              // Keep Anki's duplicate check as a backstop: it scopes by note type rather than
              // the probe's deck. Refusing is safer than duplicating.
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
          media_name: mediaName(sentence.media),
          media_id: sentence.media.publicId,
          export_method: exportMethod,
          // Measure dictionary-pick usage separately from context-only exports.
          picked_dictionaries: withWordFields ? (minedWord?.pickedDictionaries ?? 0) : 0,
        });

        useToastSuccess($i18n.t('anki.toast.cardAdded'));
      } catch (error) {
        reportError('anki:export-failed', error, { 'segment.publicId': sentence.segment.publicId });
        trackExportFailed('error', {
          error_message: error instanceof Error ? error.message : String(error),
        });
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

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
