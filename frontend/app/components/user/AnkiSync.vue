<script setup lang="ts">
import {
  mdiBookOpenVariant,
  mdiChartLine,
  mdiCheckBold,
  mdiChevronLeft,
  mdiContentCopy,
  mdiDelete,
  mdiFormatColorHighlight,
  mdiImage,
  mdiNumeric,
  mdiPencil,
  mdiPlus,
  mdiText,
  mdiVideo,
  mdiVolumeHigh,
} from '@mdi/js';
import { useTimeoutFn } from '@vueuse/core';
import type { AnkiConnectFailure, AnkiProfile } from '@/stores/anki';
import { isAnkiUnavailable } from '@/stores/anki';
import { ANKI_CARD_CSS } from '~/utils/ankiWord';
import { copyToClipboard } from '~/utils/media';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();

const store = ankiStore();
const user_store = userStore();

const isError = ref(false);
const isLoading = ref(false);
const isSuccess = ref(false);
const isSaving = ref(false);

const deckOptions = ref<string[]>([]);
const modelOptions = ref<string[]>([]);
const fieldOptions = ref<{ key: string; value: string }[]>([]);
const selectedDeck = ref('');
const selectedModel = ref('');
const modelKey = ref<string | null>(null);
const ankiconnectAddress = ref('http://127.0.0.1:8765');
const openBrowserOnExport = ref(true);

const showNameModal = ref(false);
const nameModalInput = ref('');
const nameModalMode = ref<'create' | 'rename'>('create');

let suppressWatchers = false;

const activeProfileId = computed(() => store.activeProfile?.id ?? null);
const hasKeyField = computed(() => !!modelKey.value?.trim());

const loadFromActiveProfile = () => {
  const profile = store.activeProfile;
  if (!profile) return;

  selectedDeck.value = profile.deck ?? '';
  selectedModel.value = profile.model ?? '';
  fieldOptions.value = profile.fields?.map((f) => ({ ...f })) ?? [];
  modelKey.value = profile.key ?? null;
  ankiconnectAddress.value = profile.serverAddress ?? 'http://127.0.0.1:8765';
  openBrowserOnExport.value = profile.openBrowserOnExport !== false;
};

let pendingSaveData: Partial<AnkiProfile> = {};

// `useTimeoutFn` cancels the pending write on unmount, which is what we want
// here: a save that lands after the user navigated away would write whatever
// the form held mid-edit, with nothing left on screen to report a failure.
/**
 * "Saved", held on screen after the write rather than a toast.
 *
 * Everything on this page autosaves, so a toast per change would fire on every
 * pause while typing a field template and on each of the eight controls around
 * it -- an interruption for the one outcome the reader expected. Failure still
 * toasts, which is the asymmetry worth keeping: silence when it worked, an
 * interruption when it did not.
 *
 * The line it replaces said only "Saving...", and a save takes about a tenth of
 * a second: it faded in and back out inside a blink, so the reader was told
 * nothing either way. Lingering is the whole point -- the message has to outlast
 * the event it is reporting to be read at all.
 */
const justSaved = ref(false);
const { start: holdSavedMessage, stop: cancelSavedMessage } = useTimeoutFn(
  () => {
    justSaved.value = false;
  },
  2500,
  { immediate: false },
);

const { start: scheduleSave } = useTimeoutFn(
  async () => {
    const toSave = { ...pendingSaveData };
    pendingSaveData = {};
    isSaving.value = true;
    // Cleared up front so a second edit landing while "Saved" is still on screen
    // reads as the new write in progress, not as the old one still being done.
    cancelSavedMessage();
    justSaved.value = false;
    try {
      await store.updateActiveProfile(toSave);
      justSaved.value = true;
      holdSavedMessage();
    } catch (error) {
      // Autosave: the user gets no other signal that their field mapping was lost.
      handleApiError('anki:profile-save-failed', error, { toastKey: 'accountSettings.anki.profileSaveError' });
    } finally {
      isSaving.value = false;
    }
  },
  400,
  { immediate: false },
);

const debouncedSave = (data: Partial<AnkiProfile>) => {
  if (suppressWatchers) return;
  Object.assign(pendingSaveData, data);
  scheduleSave();
};

/**
 * Add a placeholder to a field, keeping whatever is already in it.
 *
 * It used to REPLACE, which made the menu a one-of-these picker and quietly put
 * a ceiling on what a field could say -- there was no way to build
 * `{definition:sanseido}<br>{definition:jmdict}` except by typing both by hand,
 * and no reason to think you could, since every click wiped the last one.
 *
 * `<br>` between them because these land in Anki HTML fields and stacking is
 * what a reader is doing when they add a second one. Anything else -- a space,
 * a dash, parentheses around a reading -- is a line edit away in the input
 * beside the menu, which is also where a placeholder added by mistake comes off
 * again.
 */
const appendFieldPlaceholder = (fieldName: string, placeholder: string) => {
  const field = fieldOptions.value.find((field) => field.key === fieldName);
  if (!field) return;
  field.value = field.value ? `${field.value}<br>${placeholder}` : placeholder;
};

const ankiCardCss = ANKI_CARD_CSS;
const copyCardCss = () => copyToClipboard(ankiCardCss);

const switchProfile = async (profileId: string) => {
  suppressWatchers = true;
  store.setActiveProfileId(profileId);
  loadFromActiveProfile();
  await nextTick();
  suppressWatchers = false;
  await fetchAndLoad();
};

const openCreateModal = () => {
  nameModalInput.value = '';
  nameModalMode.value = 'create';
  showNameModal.value = true;
};

const openRenameModal = () => {
  nameModalInput.value = store.activeProfile?.name ?? '';
  nameModalMode.value = 'rename';
  showNameModal.value = true;
};

const confirmNameModal = async () => {
  const trimmed = nameModalInput.value.trim();
  if (!trimmed) return;
  showNameModal.value = false;

  if (nameModalMode.value === 'create') {
    isSaving.value = true;
    suppressWatchers = true;
    try {
      const profile = await store.createProfile(trimmed);
      store.setActiveProfileId(profile.id);
      loadFromActiveProfile();
      await nextTick();
      await fetchAndLoad();
    } catch (error) {
      handleApiError('anki:profile-create-failed', error, { toastKey: 'accountSettings.anki.profileSaveError' });
    } finally {
      suppressWatchers = false;
      isSaving.value = false;
    }
  } else {
    isSaving.value = true;
    try {
      await store.updateActiveProfile({ name: trimmed });
    } catch (error) {
      handleApiError('anki:profile-rename-failed', error, { toastKey: 'accountSettings.anki.profileSaveError' });
    } finally {
      isSaving.value = false;
    }
  }
};

// Profile names are routinely Japanese, so Enter may be confirming an IME
// conversion rather than submitting -- see #399.
const nameModalEnterSubmit = useEnterSubmit(confirmNameModal);

const deleteCurrentProfile = async () => {
  const active = store.activeProfile;
  if (!active) return;

  isSaving.value = true;
  suppressWatchers = true;
  try {
    await store.deleteProfile(active.id);
    loadFromActiveProfile();
    await nextTick();
    if (store.activeProfile) {
      await fetchAndLoad();
    }
  } catch (error) {
    handleApiError('anki:profile-delete-failed', error, { toastKey: 'accountSettings.anki.profileSaveError' });
  } finally {
    suppressWatchers = false;
    isSaving.value = false;
  }
};

/**
 * The reader's own Shirabe dictionaries, for the `{definition:<slug>}` picker.
 *
 * Read from the connection endpoint the settings page already has rather than
 * from a session field, because the NAMES only exist over there: a reader's own
 * uploads are filed under a hash of their contents, so a picker built from slugs
 * alone would offer `yomitan-c89af12122021a8a` to the person who uploaded
 * 三省堂国語辞典. Same call `ConnectionsCard` makes.
 *
 * Failure is silent and leaves the list empty, which hides the submenu: a reader
 * who has linked nothing has no dictionaries to name, and that is by far the
 * commonest case rather than an error worth a toast.
 */
type ShirabeDictionary = { slug: string; name: string; language: string | null };
const shirabeDictionaries = ref<ShirabeDictionary[]>([]);

/** Which field's menu is currently showing the dictionary list, by field name.
 *  Null is the ordinary placeholder menu. */
const dictionaryPickerFor = ref<string | null>(null);

const { openDropdownId } = useDropdownState();
// Reopening a menu starts at the top level. Without this a reader who drilled
// in, closed the menu and opened it again would land in the dictionary list with
// no memory of having asked for it.
watch(openDropdownId, () => {
  dictionaryPickerFor.value = null;
});

async function loadShirabeDictionaries() {
  try {
    const data = await $fetch<{
      connection: { dictionaries?: string[]; dictionaryNames?: Record<string, string> } | null;
    }>('/v1/user/connections/shirabe');
    const names = data.connection?.dictionaryNames ?? {};
    // A stack entry is `slug:language`, and the same dictionary sits in the
    // stack twice for a reader who reads it in two languages -- but a FIELD maps
    // to the dictionary, not to one language of it, so the slug is deduped here.
    const seen = new Set<string>();
    const list: ShirabeDictionary[] = [];
    for (const source of data.connection?.dictionaries ?? []) {
      const separator = source.lastIndexOf(':');
      const slug = separator === -1 ? source : source.slice(0, separator);
      const language = separator === -1 ? null : source.slice(separator + 1).toUpperCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      list.push({ slug, name: names[slug] || slug, language });
    }
    shirabeDictionaries.value = list;
  } catch {
    shirabeDictionaries.value = [];
  }
}

onMounted(async () => {
  await store.migrateFromLocalStorage();
  if (store.profiles.length === 0) {
    await store.createProfile(t('accountSettings.anki.defaultProfile'));
  }
  await fetchAndLoad();
  // Not awaited with the rest: the picker is an extra, and a slow or failing
  // connection lookup must not hold up the fields table.
  void loadShirabeDictionaries();
  suppressWatchers = true;
  loadFromActiveProfile();
  await nextTick();
  suppressWatchers = false;
});

/**
 * The diagnosis, and the reason this panel is worth more than the toast it
 * replaced.
 *
 * `connectFailure` is `null` on the paths that fail before anything is attempted
 * (no active profile), so `unreachable` is the fallback -- it is the reason that
 * generic advice fits, which is exactly what an unknown failure needs.
 */
const failureReason = computed<AnkiConnectFailure>(() => store.connectFailure ?? 'unreachable');
const failureTitle = computed(() => t(`accountSettings.anki.connectFailure.${failureReason.value}.title`));
const failureBody = computed(() => t(`accountSettings.anki.connectFailure.${failureReason.value}.body`));
const showGenericTips = computed(() => failureReason.value === 'unreachable');

const fetchAndLoad = async () => {
  if (!store.activeProfile) return;

  isError.value = false;
  isSuccess.value = false;
  isLoading.value = true;
  try {
    await store.loadAnkiData();
    deckOptions.value = store.availableDecks;
    modelOptions.value = store.availableModels;
    isSuccess.value = true;
  } catch (error) {
    // AnkiConnect runs on the user's own machine; `isError` already renders the
    // "can't reach Anki" panel with setup instructions, so no toast on top of it.
    isError.value = true;
    // And no error report either, when the reason is that Anki was not there to
    // answer. `loadAnkiData` has already captured `anki_connection_tested` with
    // the specific reason, which is the part worth keeping -- the throw itself
    // has no fix in the app, and filing it put 124 reports from 25 readers into
    // the issue list in the week to 2026-08-23. A failure of any other kind is
    // a fault in the store and still reports.
    if (!isAnkiUnavailable(error)) {
      handleApiError('anki:connect-load-failed', error, { toastKey: false });
    }
  } finally {
    isLoading.value = false;
  }
};

watch(selectedModel, async (newValue, oldValue) => {
  if (suppressWatchers) return;
  if (newValue !== oldValue) {
    try {
      const data = await store.getAllModelFieldNames(newValue);
      if (data) {
        const newFields = data.map((field: string) => {
          const existingField = fieldOptions.value.find((f) => f.key === field);
          return {
            key: field,
            value: existingField ? existingField.value : '',
          };
        });
        fieldOptions.value = newFields;
      }
      debouncedSave({ model: newValue, fields: fieldOptions.value });
    } catch (error) {
      handleApiError('anki:model-fields-load-failed', error, {
        toastKey: 'accountSettings.anki.fieldLoadError',
        context: { 'anki.model': newValue },
      });
    }
  }
});

/**
 * Picking a deck suggests the note type that deck is mostly made of.
 *
 * Only when nothing is selected yet, and that condition is the whole safety
 * argument. Changing the note type reloads the field list from the new model,
 * and any field whose name does not survive loses its mapping -- so a reader who
 * has already wired up their fields and then changes deck must keep the model
 * they chose. The suggestion is for the setup that has not happened yet, where
 * the alternative is a second dropdown with exactly one sensible answer in it.
 *
 * `suppressWatchers` is checked here rather than relying on `debouncedSave`'s
 * own guard, because this does more than save: without it, loading a profile
 * that has a deck but no model would fire a probe at Anki and write a model the
 * reader never picked.
 */
watch(selectedDeck, async (newValue) => {
  debouncedSave({ deck: newValue || undefined });

  if (suppressWatchers || !newValue || selectedModel.value) return;

  const suggested = await store.mostCommonModelInDeck(newValue);

  // Re-checked after the await: the reader may have picked a model themselves
  // while Anki was answering, or moved on to a different deck entirely, and
  // either way the answer in hand is no longer about what is on screen.
  if (!suggested || selectedModel.value || selectedDeck.value !== newValue) return;
  if (!modelOptions.value.includes(suggested)) return;

  selectedModel.value = suggested;
});

watch(modelKey, (newValue) => {
  debouncedSave({ key: newValue ?? undefined });
});

watch(
  fieldOptions,
  (newValue) => {
    debouncedSave({ fields: [...newValue] });
  },
  { deep: true },
);

watch(openBrowserOnExport, (newValue) => {
  debouncedSave({ openBrowserOnExport: newValue });
});

watch(ankiconnectAddress, (newValue) => {
  debouncedSave({ serverAddress: newValue });
  fetchAndLoad();
});
</script>
<template>
  <div class="anki">
    <!-- AnkiConnect Server Address + Sync Status -->
    <div class="nd-settings-card">
        <h3 class="nd-settings-title">{{ $t('accountSettings.anki.syncStatus') }}</h3>
        <div class="mt-4">
          <label class="block mb-2 font-medium text-white">{{ $t('accountSettings.anki.serverAddressLabel') }}</label>
          <input v-model="ankiconnectAddress"
            class="nd-input resize-none">
          </input>
        </div>

        <div class="mt-4 flex items-center gap-3">
          <label class="relative inline-flex items-center cursor-pointer">
            <input v-model="openBrowserOnExport" type="checkbox" class="sr-only peer" />
            <div class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-button-accent-main transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
          <span class="text-sm text-gray-300">{{ $t('accountSettings.anki.openBrowserOnExport') }}</span>
        </div>


        <div class="mt-4">
          <div v-if="isLoading" role="alert"
            class="rounded border-s-4 border-blue-500 bg-blue-50 p-4 dark:border-blue-600 dark:bg-blue-900/60">
            <div class="flex items-center gap-2 text-blue-800 dark:text-blue-100">
              <div role="status">
                <svg aria-hidden="true"
                  class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                  viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                    fill="currentColor" />
                  <path
                    d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                    fill="currentFill" />
                </svg>
                <span class="sr-only">{{ $t('accountSettings.anki.loading') }}</span>
              </div>
              <strong class="block font-medium">{{ $t('accountSettings.anki.loading') }}</strong>
            </div>
            <p class="mt-2 text-sm text-blue-700 dark:text-blue-200">
              {{ $t('accountSettings.anki.loadingMessage') }}
            </p>
          </div>

          <div v-if="isSuccess" role="alert"
            class="rounded-lg border border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
            <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
              <UiBaseIcon :path="mdiCheckBold" size="20" />
              <strong class="block font-medium">{{ $t('accountSettings.anki.connectionSuccess') }}</strong>
            </div>
            <p class="mt-2 text-sm text-green-700 dark:text-green-200">
              {{ $t('accountSettings.anki.successMessage') }}
            </p>
          </div>

          <div v-if="isError" role="alert"
            class="rounded border-s-4 border-red-500 bg-red-50 p-4 dark:border-red-600 dark:bg-red-900/70">
            <div class="flex items-center gap-2 text-red-800 dark:text-red-100">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                <path fill-rule="evenodd"
                  d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                  clip-rule="evenodd" />
              </svg>
              <strong class="block font-medium">{{ failureTitle }}</strong>
            </div>
            <p class="mt-2 text-sm text-red-700 dark:text-red-200">
              {{ failureBody }}
            </p>
            <!--
              The three generic tips only for `unreachable`. Every other reason
              names its own fix above, and listing "make sure Anki is running"
              under "Anki is running and is waiting for you" is how this panel
              used to send people looking in the wrong place.
            -->
            <ol v-if="showGenericTips" class="pl-5 text-sm dark:text-red-200 list-disc">
              <li>
                {{ $t('accountSettings.anki.troubleshootingTips.ankiRunning') }}
                <a class="underline text-blue-400" href="https://ankiweb.net/shared/info/2055492159">Ankiconnect</a>
              </li>
              <li>
                {{ $t('accountSettings.anki.troubleshootingTips.webCors') }}
              </li>
              <li>
                {{ $t('accountSettings.anki.troubleshootingTips.adBlock') }}
              </li>
            </ol>
          </div>
        </div>
      </div>

    <!-- Profile Selector -->
    <div v-if="store.profiles.length > 0" class="nd-settings-card">
      <h3 class="nd-settings-title">{{ $t('accountSettings.anki.profile') }}</h3>
      <div class="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <select
          :value="activeProfileId"
          class="nd-input flex-grow sm:w-auto resize-none"
          @change="switchProfile(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="profile in store.profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}
          </option>
        </select>
        <!-- Wraps, and takes the card's width to wrap WITHIN. The row is
             `items-start` in a column on mobile, so this box is sized by its
             contents rather than by the card -- three buttons that do not fit
             then push past the card's edge instead of moving to a second line. -->
        <div class="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            class="nd-btn"
            :disabled="isSaving"
            @click="openRenameModal"
          >
            <UiBaseIcon :path="mdiPencil" size="16" />
            {{ $t('accountSettings.anki.renameProfile') }}
          </button>
          <button
            class="nd-btn-accent"
            :disabled="isSaving"
            @click="openCreateModal"
          >
            <UiBaseIcon :path="mdiPlus" size="16" />
            {{ $t('accountSettings.anki.newProfile') }}
          </button>
          <button
            v-if="store.profiles.length > 1"
            class="nd-btn-danger"
            :disabled="isSaving"
            @click="deleteCurrentProfile"
          >
            <UiBaseIcon :path="mdiDelete" size="16" />
            {{ $t('accountSettings.anki.deleteProfile') }}
          </button>
        </div>
      </div>
      <!-- `aria-live="polite"`: the only confirmation a change was kept, and it
           is a line of text that appears without focus moving to it. -->
      <p
        data-testid="anki-save-status"
        aria-live="polite"
        class="mt-2 text-sm transition-opacity duration-200"
        :class="[isSaving || justSaved ? 'opacity-100' : 'opacity-0', justSaved && !isSaving ? 'text-green-400' : 'text-gray-400']">
        {{ isSaving ? $t('accountSettings.anki.saving') : justSaved ? $t('accountSettings.anki.saved') : '' }}
      </p>
    </div>

    <template v-if="store.activeProfile">
      <!-- Anki Config -->
      <div class="nd-settings-card">
        <h3 class="nd-settings-title">{{ $t('accountSettings.anki.ankiConfig') }}</h3>
        <div
          v-if="!hasKeyField"
          data-testid="anki-key-field-warning"
          role="alert"
          class="mt-4 rounded border-s-4 border-amber-500 bg-amber-50 p-4 dark:border-amber-400 dark:bg-amber-900/30">
          <p class="font-medium text-amber-900 dark:text-amber-100">
            {{ $t('accountSettings.anki.keyFieldRequiredTitle') }}
          </p>
          <p class="mt-1 text-sm text-amber-800 dark:text-amber-200">
            {{ $t('accountSettings.anki.keyFieldRequiredMessage') }}
          </p>
        </div>
        <div class="mt-4">
          <div class="flex flex-col gap-4 lg:flex-row lg:gap-8 mb-5">
            <div class="flex-grow">
              <label class="block mb-1 font-medium text-white">{{ $t('accountSettings.anki.deckLabel') }}</label>
              <select v-model="selectedDeck" data-testid="anki-deck-select"
                class="nd-input resize-none">
                <option value="">{{ $t('accountSettings.anki.selectDeck') }}</option>
                <option v-for="(option, index) in deckOptions" :key="index" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
            <div class="flex-grow">
              <label class="block mb-1 font-medium text-white">{{ $t('accountSettings.anki.modelLabel') }}</label>
              <select v-model="selectedModel" data-testid="anki-model-select"
                class="nd-input resize-none">
                <option value="">{{ $t('accountSettings.anki.selectModel') }}</option>
                <option v-for="(option, index) in modelOptions" :key="index" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <div class="flex flex-col gap-4 lg:flex-row lg:gap-8 mb-5">
            <div class="flex-grow">
              <label class="block mb-1 font-medium text-white">{{ $t('accountSettings.anki.keyFieldLabel') }}</label>
              <select v-model="modelKey" data-testid="anki-key-field-select"
                class="nd-input resize-none">
                <option :value="null">{{ $t('accountSettings.anki.selectKeyField') }}</option>
                <option v-for="(option, index) in fieldOptions" :key="index" :value="option.key">
                  {{ option.key }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Said here because the menu below gives no other sign of it: picking
             adds rather than replaces, and a reader who does not know that has
             no reason to try a second placeholder. -->
        <p class="mb-3 text-sm text-gray-400">{{ $t('accountSettings.anki.fieldComposeHelp') }}</p>

        <!-- Below `md` this is not a table at all: every row becomes a block,
             the field name a label above its own full-width input, and the
             header is dropped because each row now carries its own.

             A two-column table cannot be made to work on a phone here. Field
             names are `whitespace-nowrap` and a note type's are routinely long
             (`ExpressionFurigana`), so the table's own minimum width is wider
             than the screen: it either widened the card and the page with it, or
             -- once made to scroll -- hid the placeholder column off the edge
             with no sign it was there, put the input inside a scroll container
             that clipped its own menu, and closed that menu again on the scroll
             the browser fired to bring the focused input into view.

             `md` rather than `sm` because it is where this page already switches
             between a sidebar and the tab bar. -->
        <div class="md:border md:rounded-lg md:dark:border-modal-border">
          <table class="block w-full md:table md:divide-y md:bg-graypalid/20 md:divide-gray-200 md:dark:divide-white/30">
            <thead class="hidden md:table-header-group">
              <tr class="divide-x bg-input-background divide-gray-200 dark:divide-white/30">
                <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.anki.fieldColumn') }}</th>
                <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.anki.contentColumn') }}</th>
              </tr>
            </thead>
            <tbody class="block md:table-row-group md:divide-y md:divide-gray-200 md:dark:divide-white/20">
              <tr
                class="block border-b border-hairline pb-3 mb-3 last:border-0 last:pb-0 last:mb-0 md:table-row md:divide-x md:divide-gray-200 md:dark:divide-white/20 md:border-0 md:p-0 md:m-0"
                v-for="(item, index) in fieldOptions"
                :key="index"
                data-testid="anki-field-row"
                :data-field="item.key"
              >
                <!-- The row's own label when stacked, a table cell when not: left
                     aligned above its input on a phone, centred in its column on a
                     wide screen. `break-words` because the name is only allowed to
                     be `nowrap` while it has a column of its own. -->
                <td
                  class="block break-words text-left text-sm text-gray-400 md:w-6/12 md:table-cell md:whitespace-nowrap md:text-center md:text-base md:px-2 md:font-medium md:text-gray-800 md:dark:text-gray-200">
                  {{ item.key }}
                </td>
                <td class="block md:table-cell md:whitespace-nowrap md:text-center md:text-base md:px-2 md:font-medium md:text-gray-800 md:dark:text-gray-200">
                  <!-- One control: the placeholder input with the menu tucked into
                       its right edge as a borderless chevron. The container IS the
                       bordered box (`rootClass`), so the menu anchors below the WHOLE
                       control (`inset-x-0`, no corner overlap), and focusing the input
                       opens it -- the reader picks from the list or just types. -->
                  <SearchDropdownContainer
                    dropdownId="nd-dropdown-with-header"
                    rootClass="relative flex items-center mt-1 mb-0 md:my-3 md:mx-2 rounded-lg border border-hairline bg-input-background focus-within:border-neutral-500"
                    dropdownContainerClass="absolute top-full inset-x-0 z-50 mt-1">
                    <template #default="{ isOpen, toggle }">
                      <input v-model="item.value" data-testid="anki-field-value"
                        class="grow min-w-0 py-2 ps-3 pe-1 bg-transparent border-0 text-gray-800 focus:ring-0 dark:text-white"
                        type="text" @focus="isOpen || toggle()" />
                      <SearchDropdownMainButton
                        dropdownId="nd-dropdown-with-header"
                        dropdownButtonClass="flex items-center self-stretch px-2.5 rounded-e-lg text-gray-400 hover:text-gray-200 focus:outline-none" />
                    </template>
                    <template #content>
                        <SearchDropdownContent>
                          <!-- Adding a placeholder APPENDS (see appendFieldPlaceholder), so
                               the menu stays open to stack several -- a gloss from each
                               dictionary, a reading beside a word -- instead of closing on
                               the first pick and making the reader reopen it for the next.
                               `data-nd-keep-open` is what tells DropdownContainer.onMenuClick
                               not to dismiss on the click. -->
                          <div data-nd-keep-open>
                            <template v-if="dictionaryPickerFor !== item.key">
                                <!-- SENTENCE: everything about the mined LINE, grouped as
                                     the three Japanese forms, then translations, then
                                     media, then the episode it came from. -->
                                <div class="nd-menu-label">
                                  {{ $t('accountSettings.anki.sentenceGroup') }}
                                </div>
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-jp}')"
                                  :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
                                <!-- The same sentence with the mined word marked.
                                     Offered next to the plain one rather than
                                     replacing it: a reader with cards already
                                     built keeps the field they mapped. -->
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{content_jp_highlight}')"
                                  :text="$t('searchpage.main.buttons.jpsentencehighlight')" :iconPath="mdiFormatColorHighlight" />
                                <!-- The whole line's readings, beside the other Japanese
                                     forms it belongs with (it resolves from the SENTENCE,
                                     not the word). Yomitan cannot produce this at all;
                                     our parse already has every token's reading. -->
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-furigana}')"
                                  :text="$t('searchpage.main.buttons.sentencefurigana')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-en}')"
                                  :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-es}')"
                                  :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-audio}')"
                                  :text="$t('accountSettings.anki.sentenceAudio')" :iconPath="mdiVolumeHigh" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{image}')"
                                  :text="$t('accountSettings.anki.sentenceImage')" :iconPath="mdiImage" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{sentence-info}')"
                                  :text="$t('searchpage.main.buttons.info')" :iconPath="mdiText" />
                                <!-- SELECTED WORD: facts about the mined word, which only
                                     the word card can fill (mined by clicking a word in a
                                     sentence, not from the Add to Anki dropdown). Ordered
                                     word forms, then audio, then definitions, then the
                                     three pitch fields together, then the numeric
                                     metadata. A field mapped here is left untouched by the
                                     other export paths. -->
                                <div class="nd-menu-label">
                                  {{ $t('accountSettings.anki.selectedWordGroup') }}
                                </div>
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word}')"
                                  :text="$t('searchpage.main.buttons.word')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-reading}')"
                                  :text="$t('searchpage.main.buttons.wordreading')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-furigana}')"
                                  :text="$t('searchpage.main.buttons.wordfurigana')" :iconPath="mdiText" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-audio}')"
                                  :text="$t('searchpage.main.buttons.wordaudio')" :iconPath="mdiVolumeHigh" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{definition}')"
                                  :text="$t('searchpage.main.buttons.definition')" :iconPath="mdiBookOpenVariant" />
                                <!-- Whatever sits at the top of their Shirabe
                                     stack. The zero-setup version of the named
                                     dictionary below: it follows a reorder over
                                     there, and cannot go stale when a dictionary
                                     is swapped out. -->
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{definition-first}')"
                                  :text="$t('searchpage.main.buttons.definitionFirst')" :iconPath="mdiBookOpenVariant" />
                                <!-- The three pitch fields kept together: the graph, the
                                     position number on its own (for a note type that draws
                                     its own diagram), and the accent pattern. -->
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-pitch}')"
                                  :text="$t('searchpage.main.buttons.wordpitch')" :iconPath="mdiChartLine" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-pitch-num}')"
                                  :text="$t('searchpage.main.buttons.wordpitchnum')" :iconPath="mdiNumeric" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-pitch-categories}')"
                                  :text="$t('searchpage.main.buttons.wordpitchcategories')" :iconPath="mdiChartLine" />
                                <!-- A plain rank, so a note type can sort a deck
                                     on it the way Lapis's FreqSort does. -->
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-frequency}')"
                                  :text="$t('searchpage.main.buttons.wordfrequency')" :iconPath="mdiNumeric" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-jlpt}')"
                                  :text="$t('searchpage.main.buttons.wordjlpt')" :iconPath="mdiNumeric" />
                                <SearchDropdownItem @click="appendFieldPlaceholder(item.key, '{word-info}')"
                                  :text="$t('searchpage.main.buttons.wordinfo')" :iconPath="mdiText" />
                                <!-- One named dictionary, for a note type that
                                     wants 三省堂 in one field and JMdict in
                                     another. Only offered to a reader who has
                                     dictionaries to name, which means a linked
                                     Shirabe account: for everybody else the three
                                     definition rows above are the whole story.

                                     `data-nd-keep-open` because this opens the
                                     next level of the SAME menu -- without it the
                                     container's click handler closes the dropdown
                                     on the way in. -->
                                <span v-if="shirabeDictionaries.length > 0" data-nd-keep-open>
                                  <SearchDropdownItem
                                    data-testid="anki-dictionary-submenu"
                                    :text="$t('accountSettings.anki.dictionarySubmenu')"
                                    :iconPath="mdiBookOpenVariant"
                                    @click="dictionaryPickerFor = item.key" />
                                </span>
                                </template>

                                <!-- The dictionary list: the same menu, one level
                                     in. A list rather than a nested flyout because
                                     a reader with nine dictionaries needs the room,
                                     and because a flyout on a settings table that
                                     already sits inside a scrolling panel is a
                                     placement problem with no good answer. -->
                                <template v-else>
                                  <span data-nd-keep-open>
                                    <SearchDropdownItem
                                      data-testid="anki-dictionary-back"
                                      :text="$t('accountSettings.anki.dictionaryBack')"
                                      :iconPath="mdiChevronLeft"
                                      @click="dictionaryPickerFor = null" />
                                  </span>
                                  <div class="nd-menu-label">
                                    {{ $t('accountSettings.anki.dictionaryGroup') }}
                                  </div>
                                  <SearchDropdownItem
                                    v-for="dictionary in shirabeDictionaries"
                                    :key="dictionary.slug"
                                    data-testid="anki-dictionary-option"
                                    :text="dictionary.language ? `${dictionary.name} (${dictionary.language})` : dictionary.name"
                                    :iconPath="mdiBookOpenVariant"
                                    @click="appendFieldPlaceholder(item.key, `{definition:${dictionary.slug}}`)" />
                                </template>
                          </div>
                        </SearchDropdownContent>
                      </template>
                    </SearchDropdownContainer>
                </td>
              </tr>
            </tbody>
          </table>
          <section v-if="isLoading" class="container border-modal-border rounded-xl px-4 mx-auto">
            <div class="flex items-center my-6 text-center rounded-lg h-96">
              <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                <div class="p-1.5 min-w-full inline-block align-middle">
                  <span
                    class="animate-spin text-center inline-block mt-1 mr-2 w-10 h-10 border-[3px] border-current border-t-transparent border-sred text-white rounded-full"
                    role="status">
                  </span>
                </div>
              </div>
            </div>
          </section>
          <section v-else-if="deckOptions.length === 0 && !isLoading" class="rounded-xl mx-auto">
            <div class="flex items-center text-center h-96 dark:border-gray-700 bg-input-backgroundhover">
              <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                <div class="p-3 mx-auto text-sred bg-blue-100 rounded-full dark:bg-input-background">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <h1 class="mt-3 text-lg text-gray-800 dark:text-white">{{ $t('accountSettings.anki.noFieldsFound') }}</h1>
                <p class="mt-2 text-gray-500 dark:text-gray-400">
                  {{ $t('accountSettings.anki.noFieldsMessage') }}
                </p>
              </div>
            </div>
          </section>
        </div>

        <!-- The word fields land as classed markup and carry no styling of their
             own, so that the reader owns how their card looks. Anki has nowhere
             to put a stylesheet except the note type, and a `<style>` block
             inside a field would be copied onto every note ever mined -- so the
             sheet is offered here to paste once. -->
        <details class="mt-6 border rounded-lg dark:border-modal-border">
          <summary class="px-4 py-3 cursor-pointer text-white select-none">
            {{ $t('accountSettings.anki.cardStylingTitle') }}
          </summary>
          <div class="px-4 pb-4">
            <p class="mb-3 text-sm text-gray-400">{{ $t('accountSettings.anki.cardStylingHelp') }}</p>
            <div class="relative">
              <pre
                class="max-h-64 overflow-auto rounded-lg bg-input-background p-3 text-xs text-gray-200 whitespace-pre"><code>{{ ankiCardCss }}</code></pre>
              <button type="button" @click="copyCardCss"
                class="absolute top-2 end-2 inline-flex items-center gap-x-1 rounded-md bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path :d="mdiContentCopy" fill="currentColor" />
                </svg>
                {{ $t('searchpage.main.buttons.copyclipboard') }}
              </button>
            </div>
          </div>
        </details>
      </div>

    </template>

    <CommonBaseModal
      :open="showNameModal"
      z-index-class="z-50"
      overlay-class="items-center justify-center bg-black/60"
      panel-class="bg-background border border-hairline rounded-lg p-6 w-full max-w-sm shadow-xl"
      labelledby="nd-anki-profile-name-title"
      @close="showNameModal = false"
    >
      <h3 id="nd-anki-profile-name-title" class="text-lg font-semibold text-white mb-4">
        {{ nameModalMode === 'create' ? $t('accountSettings.anki.newProfile') : $t('accountSettings.anki.renameProfile') }}
      </h3>
      <input
        v-model="nameModalInput"
        data-autofocus
        type="text"
        :placeholder="$t('accountSettings.anki.profileNamePlaceholder')"
        class="nd-input"
        v-on="nameModalEnterSubmit"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button
          class="nd-btn"
          @click="showNameModal = false"
        >
          {{ $t('accountSettings.anki.modal.cancel') }}
        </button>
        <button
          class="nd-btn-accent bg-red-500 hover:bg-red-600"
          :disabled="!nameModalInput.trim()"
          @click="confirmNameModal"
        >
          {{ nameModalMode === 'create' ? $t('accountSettings.anki.newProfile') : $t('accountSettings.anki.modal.save') }}
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
