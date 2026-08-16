<script setup lang="ts">
import { mdiPlus, mdiCheckBold, mdiPencilOutline, mdiContentCopy, mdiDotsVertical, mdiAlertOutline } from '@mdi/js';
import { useTimeoutFn } from '@vueuse/core';

import type { ApiKeyListItem, ApiKeyScope } from '@/stores/api';
import { normalizeApiKey, API_KEY_SCOPES, READ_ONLY_API_KEY_SCOPES, FULL_ACCOUNT_API_KEY_SCOPES } from '@/stores/api';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const { formatDate } = useFormat();
const api_store = apiStore();
const sdk = useNadeshikoSdk();
const isLoading = ref(false);
const generatedApiKey = ref<string | null>(null);
const deactivatedApiKey = ref(false);
const apiKeyCopied = ref(false);

// Clears the inline "Copied!" hint, and is cancelled on unmount by `useTimeoutFn`.
const { start: scheduleCopiedReset } = useTimeoutFn(() => (apiKeyCopied.value = false), 2000, { immediate: false });

async function copyApiKey() {
  if (!generatedApiKey.value) return;
  if (!(await copyToClipboard(generatedApiKey.value))) return;
  apiKeyCopied.value = true;
  scheduleCopiedReset();
}

// Create modal state
const modalKeyName = ref('');

type ScopePreset = 'readOnly' | 'fullAccount' | 'custom';
const modalScopePreset = ref<ScopePreset>('readOnly');
const modalCustomScopes = ref<ApiKeyScope[]>([...READ_ONLY_API_KEY_SCOPES]);

// Read-only is the default because it is the right answer for the case that
// actually sends people here -- pasting a key into a third-party learning tool
// -- and because the cost of the two mistakes is not symmetric: too few scopes
// is a second visit to this page, too many is a credential in someone else's
// code that can rewrite this account.
const selectedScopes = computed<ApiKeyScope[]>(() => {
  if (modalScopePreset.value === 'readOnly') return [...READ_ONLY_API_KEY_SCOPES];
  if (modalScopePreset.value === 'fullAccount') return [...FULL_ACCOUNT_API_KEY_SCOPES];
  return modalCustomScopes.value;
});

// Rename modal state
const renameKeyId = ref<string | null>(null);
const renameKeyName = ref('');

// Tells "no API keys yet" apart from "the list could not be loaded".
const loadFailed = ref(false);

const fetchApiKeyList = async (): Promise<unknown[]> => {
  const unwrap = (data: unknown): unknown[] => {
    if (Array.isArray(data)) return data;
    if (
      data &&
      typeof data === 'object' &&
      'apiKeys' in data &&
      Array.isArray((data as Record<string, unknown>).apiKeys)
    ) {
      return (data as Record<string, unknown>).apiKeys as unknown[];
    }
    return [];
  };

  const data = await sdk.authApiKeyList().catch((error: unknown) => {
    handleApiError('api-keys:list-failed', error, { toastKey: false });
    loadFailed.value = true;
    return [];
  });
  return unwrap(data);
};

const fetchMe = () =>
  sdk.getMe().catch((error: unknown) => {
    // Quota falls back to placeholder numbers, which would otherwise read as a
    // genuine "0 requests used" to anyone whose session just failed to load.
    handleApiError('api-keys:quota-fetch-failed', error, { toastKey: false });
    loadFailed.value = true;
    return null;
  });

// Server-rendered. `/v1/auth/api-key/list` and `/v1/user/me` are both off the
// public allowlist, so the SDK sends the reader's session cookie rather than the
// service key and the keys that come back are theirs. This was `server: false`
// while the SSR client signed everything as the service, which would have listed
// the service account's API keys instead.
const { data: apiData, refresh: refreshApiKeys } = await useAsyncData('developer-api-keys', async () => {
  loadFailed.value = false;
  const [keysRaw, meRes] = await Promise.all([fetchApiKeyList(), fetchMe()]);

  const keys = (Array.isArray(keysRaw) ? keysRaw : [])
    .map(normalizeApiKey)
    .filter((k) => k.isActive)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return {
    keys,
    quota: {
      quotaUsed: meRes?.quota?.used ?? 0,
      quotaLimit: meRes?.quota?.limit ?? 5000,
      quotaRemaining: meRes?.quota?.remaining ?? 0,
      periodEnd: meRes?.quota?.periodEnd ?? null,
      tier: meRes?.quota?.tier ?? null,
      burst: meRes?.quota?.burst ?? null,
    },
  };
});

const fieldOptions = computed(
  () =>
    apiData.value ?? {
      keys: [] as ApiKeyListItem[],
      quota: {
        quotaUsed: 0,
        quotaLimit: 5000,
        quotaRemaining: 5000,
        periodEnd: null,
        tier: null,
        burst: null,
      },
    },
);

const quotaPercentage = computed(() => {
  const used = fieldOptions.value.quota.quotaUsed;
  const limit = Math.max(1, fieldOptions.value.quota.quotaLimit);
  return (used / limit) * 100;
});

/**
 * The burst allowance, phrased per minute.
 *
 * There is no counter to pair it with, and deliberately no bar: the window is
 * 60 seconds, so any number this page rendered would describe a moment that had
 * already passed by the time it painted. What a reader needs from this is the
 * ceiling and the fact that it exists separately from the month -- because a
 * 429 with plenty of month left is otherwise unexplainable, which is what sent
 * the support thread behind this to us in the first place.
 */
const burstPerMinute = computed(() => {
  const burst = fieldOptions.value.quota.burst;
  if (!burst?.max || !burst.windowMs) return null;
  return Math.round(burst.max * (60_000 / burst.windowMs));
});

// The day the month's allowance comes back. `periodEnd` is the last instant of
// the period, so the refill is the day after it.
const quotaResetsOn = computed(() => {
  const periodEnd = fieldOptions.value.quota.periodEnd;
  if (!periodEnd) return null;
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return null;
  return formatDate(new Date(end.getTime() + 1));
});

const showCreateModal = ref(false);
const showRenameModal = ref(false);

const openCreateModal = () => {
  modalKeyName.value = '';
  modalScopePreset.value = 'readOnly';
  modalCustomScopes.value = [...READ_ONLY_API_KEY_SCOPES];
  showCreateModal.value = true;
};

const closeCreateModal = () => {
  showCreateModal.value = false;
};

const openRenameModal = (item: ApiKeyListItem) => {
  renameKeyId.value = item.id;
  renameKeyName.value = item.name;
  showRenameModal.value = true;
};

const closeRenameModal = () => {
  showRenameModal.value = false;
};

const confirmRenameApiKey = async () => {
  if (!renameKeyId.value || !renameKeyName.value) return;

  isLoading.value = true;

  try {
    // The store reports the failure and answers with a non-200 status rather than
    // throwing, so branching on `status` is the only way to notice it here.
    const response = await api_store.renameApiKey(renameKeyId.value, renameKeyName.value);
    if (response.status !== 200) {
      useToastError(t('accountSettings.developer.renameKeyError'));
      return;
    }
    closeRenameModal();
    await refreshApiKeys();
  } finally {
    isLoading.value = false;
  }
};

const confirmCreateApiKey = async () => {
  if (!modalKeyName.value || selectedScopes.value.length === 0) {
    return;
  }

  isLoading.value = true;
  generatedApiKey.value = null;

  try {
    const response = await api_store.createApiKeyGeneral(modalKeyName.value, selectedScopes.value);
    if (!response?.key) {
      useToastError(t('accountSettings.developer.createKeyError'));
      return;
    }
    generatedApiKey.value = response.key;
    closeCreateModal();
    await refreshApiKeys();
  } finally {
    isLoading.value = false;
  }
};

// Key labels are free text and readers do name them in Japanese, so Enter may
// be confirming an IME conversion rather than submitting -- see #399.
const createKeyEnterSubmit = useEnterSubmit(confirmCreateApiKey);
const renameKeyEnterSubmit = useEnterSubmit(confirmRenameApiKey);

const deactivateApiKey = async (item: ApiKeyListItem) => {
  try {
    isLoading.value = true;

    const response = await api_store.deactivateApiKey(item.id);
    if (response.status !== 200) {
      useToastError(t('accountSettings.developer.deactivateKeyError'));
      return;
    }
    deactivatedApiKey.value = true;
    await refreshApiKeys();
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
    <!-- Card -->
    <div class="nd-settings-card">
        <h3 class="nd-settings-title">{{ $t('accountSettings.developer.apiUsageTitle') }}</h3>
        <div class="mt-4">
            <!-- Progress -->
            <div class="flex items-center gap-x-3 whitespace-nowrap">
                <div class="flex w-full h-6 bg-gray-200 rounded-lg overflow-hidden dark:bg-neutral-600" role="progressbar"
                    aria-valuenow="25" aria-valuemin="0" aria-valuemax="100">
                    <div class="flex flex-col justify-center overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-gray-300"
                        :style="{ width: quotaPercentage + '%' }"></div>
                </div>
                <div class="w-8 items-center align-middle text-center flex">
                    <span class="text-sm text-gray-800 dark:text-white">{{ quotaPercentage.toFixed(0) }}%</span>
                </div>
            </div>
            <!-- End Progress -->
        </div>
        <p class="mt-3 text-gray-300">{{ $t('accountSettings.developer.apiUsageRemaining', {
          used: fieldOptions.quota?.quotaUsed,
          limit: fieldOptions.quota?.quotaLimit
        }) }}</p>
        <!--
          The two limits, side by side. They are exhausted independently and
          answer the same 429, so a page naming only the month leaves a reader
          who is bursting with no way to read their own error.
        -->
        <p v-if="quotaResetsOn" class="mt-1 text-gray-400 text-sm">
          {{ $t('accountSettings.developer.quotaResets', { date: quotaResetsOn }) }}
          <span v-if="fieldOptions.quota?.tier">
            &middot; {{ $t('accountSettings.developer.quotaTier', { tier: fieldOptions.quota.tier.displayName }) }}
          </span>
        </p>
        <p v-if="burstPerMinute" class="mt-1 text-gray-400 text-sm">
          {{ $t('accountSettings.developer.burstLimit', { max: burstPerMinute }) }}
        </p>
        <p class="mt-2 text-gray-400 text-sm">
          {{ t('accountSettings.developer.usageLimitMessage.prefix') }}
          <a href="mailto:contact@nadeshiko.co" class="text-red-400 hover:underline">contact@nadeshiko.co</a>.
        </p>
        <p class="mt-2 text-gray-400 text-sm">
          {{ t('accountSettings.developer.legacyKeysMessage.prefix') }}
          <a href="https://old.nadeshiko.co/settings/developer" target="_blank" rel="noopener noreferrer" class="text-red-400 hover:underline">old.nadeshiko.co/settings/developer</a>.
        </p>
    </div>

    <!-- Card -->
    <div class="nd-settings-card">
        <div class="flex items-center">
            <div class="flex flex-col">
                <h3 class="nd-settings-title">{{ $t('accountSettings.developer.apiKeyManagement') }}</h3>
            </div>
            <div class="ml-auto">
                <button
                    class="bg-button-accent-main hover:bg-button-accent-hover text-white font-bold py-2 px-4 rounded transition-colors" data-testid="add-api-key-button" @click="openCreateModal">
                    <UiBaseIcon display="inline" :path="mdiPlus" fill="#DDDF" w="w-5" h="h-5" size="20"/>
                    {{ $t('accountSettings.developer.addApiKey') }}
                </button>
            </div>
        </div>
        <div v-if="generatedApiKey" role="alert" data-testid="api-key-created-alert"
            class="mt-2 rounded-lg border border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
            <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20" />
                <strong class="block font-medium">{{ $t('accountSettings.developer.keyCreated') }}</strong>
            </div>
            <div class="mt-2 flex items-center gap-2">
                <code class="block flex-1 overflow-x-auto rounded bg-green-100 dark:bg-green-950 px-3 py-2 font-mono text-sm text-green-800 dark:text-green-200 whitespace-nowrap">{{ generatedApiKey }}</code>
                <button
                    type="button"
                    class="shrink-0 rounded p-1.5 text-green-700 hover:bg-green-200 dark:text-green-200 dark:hover:bg-green-800 transition-colors"
                    :title="$t('accountSettings.developer.copyApiKey')"
                    @click="copyApiKey"
                >
                    <UiBaseIcon :path="mdiContentCopy" size="18" />
                </button>
            </div>
            <p v-if="apiKeyCopied" class="mt-1 text-xs text-green-700 dark:text-green-300">{{ t('accountSettings.developer.copied') }}</p>
            <p class="mt-2 text-sm text-green-700 dark:text-green-200">
                {{$t('accountSettings.developer.keyCreatedMessage', { key: generatedApiKey }) }}
            </p>
        </div>

        <div v-if="deactivatedApiKey" role="alert" data-testid="api-key-deactivated-alert"
            class="mt-2 rounded-lg border border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
            <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20" />
                <strong class="block font-medium">{{ $t('accountSettings.developer.keyDeactivated') }}</strong>
            </div>
        </div>
        
        <div class="mt-6">
            <div class="border rounded-lg dark:border-modal-border overflow-x-auto">
                <table class="min-w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
                    <thead>
                        <tr class="divide-x bg-input-background divide-gray-200 dark:divide-white/30">
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.name') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.key') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.permissions') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.createdAt') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.status') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.options') }}</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/20">
                        <tr class="divide-x divide-gray-200 dark:divide-white/20" data-testid="api-key-row"
                            v-for="(item, index) in fieldOptions.keys">
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ item.name }}
                            </td>
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ item.hint }}•••
                            </td>
                            <td
                                class="w-4/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <div class="flex flex-col items-center justify-center w-full gap-y-2">
                                    <div class="inline-flex flex-wrap justify-center gap-2 w-full">

                                        <span v-for="(permission, index) in item?.permissions" :key="index"
                                            class="py-1 px-1.5 inline-flex items-center gap-x-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full dark:bg-blue-500/10 dark:text-blue-500">
                                            {{ permission.name }}
                                        </span>
                                    </div>
                                </div>
                            </td>
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                              <!-- For a while some db items didn't have createdAt date, so as a placeholder we show this date -->
                              {{ formatDate(item.createdAt) }}
                            </td>

                            <td
                                class="w-1/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <span v-if="!item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/50 dark:text-white/90 border border-gray-700">{{ $t('accountSettings.developer.statusInactive') }}
                                </span>
                                <span v-if="item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-green-500/50 dark:text-white/90 border border-gray-700">{{ $t('accountSettings.developer.statusActive') }}
                                </span>
                            </td>
                            <td
                                class="w-2/12 py-4 align-middle whitespace-nowrap text-base px-2 font-medium text-gray-800 dark:text-gray-200 ">
                                <div class="flex justify-center items-center h-full">
                                    <SearchDropdownContainer
                                        class="mb-2 mx-auto"
                                        dropdown-id="nd-apikey-actions"
                                        teleport
                                        teleport-align="end"
                                        dropdown-container-class="z-[60] min-w-[15rem]"
                                    >
                                        <SearchDropdownMainButton
                                            :show-chevron="false"
                                            dropdown-button-class="border-transparent dark:hover:bg-sgrayhover py-3 px-4 inline-flex justify-center items-center gap-2 rounded-lg border font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
                                        >
                                            <UiBaseIcon :path="mdiDotsVertical" w="w-5" h="h-5" size="20" />
                                        </SearchDropdownMainButton>
                                        <template #content>
                                            <SearchDropdownItem
                                                :text="$t('accountSettings.developer.rename')"
                                                :icon-path="mdiPencilOutline"
                                                @click="openRenameModal(item)"
                                            />
                                            <SearchDropdownItem
                                                danger
                                                :text="$t('accountSettings.developer.deactivate')"
                                                :icon-path="mdiAlertOutline"
                                                @click="deactivateApiKey(item)"
                                            />
                                        </template>
                                    </SearchDropdownContainer>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <section v-if="isLoading" class="container border-sgray2 rounded-xl px-4 mx-auto">
                    <div class="flex items-center my-6 text-center rounded-lg ">
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
                <section v-else-if="loadFailed" class="rounded-xl mx-auto" data-testid="api-keys-load-error">
                    <div class="flex items-center text-center h-96 dark:border-gray-700 bg-card-background">
                        <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                            <p class="text-red-400">{{ $t('accountSettings.developer.loadError') }}</p>
                            <button
                                type="button"
                                class="nd-btn mt-3 mx-auto"
                                @click="refreshApiKeys()"
                            >
                                {{ $t('searchContainer.retryButton') }}
                            </button>
                        </div>
                    </div>
                </section>
                <section v-else-if="fieldOptions.keys.length === 0" class="rounded-xl mx-auto">
                    <div class="flex items-center text-center h-96 dark:border-gray-700 bg-card-background">
                        <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                            <div class="p-3 mx-auto text-sred bg-blue-100 rounded-full dark:bg-sgray">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                </svg>
                            </div>
                            <h1 class="mt-3 text-lg text-gray-800 dark:text-white">{{ $t('accountSettings.developer.noKeysFound') }}</h1>
                            <p class="mt-2 text-gray-500 dark:text-gray-400">
                                {{ $t('accountSettings.developer.noKeysMessage') }}
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>

    <!-- Create API Key Modal -->
    <CommonBaseModal
        data-testid="create-apikey-modal"
        :open="showCreateModal"
        overlay-class="items-center justify-center bg-neutral-900/40"
        panel-class="max-h-[calc(100%-3.5rem)] flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border w-full sm:max-w-lg m-3 sm:mx-auto"
        @close="closeCreateModal"
    >
                <div
                    class="nd-modal-header"
                >
                    <h3 class="font-bold text-gray-800 dark:text-gray-200">{{ $t('accountSettings.developer.createApiKeyModal.title') }}</h3>
                    <button
                        type="button"
                        class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 transition-all text-sm"
                        @click="closeCreateModal"
                    >
                        <span class="sr-only">{{ t('common.close') }}</span>
                        <svg
                            class="w-3.5 h-3.5"
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M0.772004 0.772004C0.907186 0.636856 1.08918 0.560669 1.279 0.560669C1.46882 0.560669 1.65081 0.636856 1.786 0.772004L6.228 5.21401C6.36315 5.34919 6.43933 5.53119 6.43933 5.72101C6.43933 5.91082 6.36315 6.09282 6.228 6.22801C6.09282 6.36315 5.91082 6.43933 5.721 6.43933C5.53119 6.43933 5.34919 6.36315 5.214 6.22801L0.772004 1.786C0.636856 1.65081 0.560669 1.46882 0.560669 1.279C0.560669 1.08918 0.636856 0.907186 0.772004 0.772004Z"
                                fill="currentColor"
                            />
                            <path
                                d="M6.228 0.772004C6.36315 0.907186 6.43933 1.08918 6.43933 1.279C6.43933 1.46882 6.36315 1.65081 6.228 1.786L1.786 6.22801C1.65081 6.36315 1.46882 6.43933 1.279 6.43933C1.08918 6.43933 0.907186 6.36315 0.772004 6.22801C0.636856 6.09282 0.560669 5.91082 0.560669 5.72101C0.560669 5.53119 0.636856 5.34919 0.772004 5.21401L5.214 0.772004C5.34919 0.636856 5.53119 0.560669 5.721 0.560669C5.91082 0.560669 6.09282 0.636856 6.228 0.772004Z"
                                fill="currentColor"
                            />
                        </svg>
                    </button>
                </div>
                <div class="overflow-y-auto p-4">
                    <div class="flex flex-col gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {{ $t('accountSettings.developer.createApiKeyModal.nameLabel') }}
                            </label>
                            <input
                                v-model="modalKeyName"
                                type="text"
                                class="nd-input"
                                :placeholder="$t('accountSettings.developer.createApiKeyModal.namePlaceholder')"
                                v-on="createKeyEnterSubmit"
                            />
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {{ $t('accountSettings.developer.createApiKeyModal.scopesLabel') }}
                            </label>
                            <div class="flex flex-col gap-2">
                                <label
                                    v-for="preset in (['readOnly', 'fullAccount', 'custom'] as const)"
                                    :key="preset"
                                    class="flex items-center gap-2 cursor-pointer rounded-lg border p-3 border-hairline hover:bg-lift transition-colors"
                                    :class="{ 'border-button-accent-main dark:border-button-accent-main': modalScopePreset === preset }"
                                >
                                    <input
                                        v-model="modalScopePreset"
                                        type="radio"
                                        :value="preset"
                                        :data-testid="`create-apikey-preset-${preset}`"
                                        class="shrink-0"
                                    />
                                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
                                        {{ $t(`accountSettings.developer.createApiKeyModal.presets.${preset}.label`) }}
                                    </span>
                                </label>
                            </div>

                            <div v-if="modalScopePreset === 'custom'" class="mt-3 flex flex-col gap-1.5 pl-1">
                                <label
                                    v-for="scope in API_KEY_SCOPES"
                                    :key="scope"
                                    class="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300"
                                >
                                    <input
                                        v-model="modalCustomScopes"
                                        type="checkbox"
                                        :value="scope"
                                        :data-testid="`create-apikey-scope-${scope}`"
                                    />
                                    <code class="font-mono text-xs">{{ scope }}</code>
                                </label>
                                <p v-if="modalCustomScopes.length === 0" class="text-xs text-red-400 mt-1">
                                    {{ $t('accountSettings.developer.createApiKeyModal.scopesRequired') }}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    class="flex justify-end items-center gap-2 py-3 px-4 border-t dark:border-modal-border"
                >
                    <button
                        type="button"
                        data-testid="create-apikey-submit"
                        class="px-4 py-2 text-sm font-medium text-white bg-button-accent-main rounded-lg hover:bg-button-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!modalKeyName || selectedScopes.length === 0 || isLoading"
                        @click="confirmCreateApiKey"
                    >
                        {{ $t('accountSettings.developer.createApiKeyModal.create') }}
                    </button>
                </div>
    </CommonBaseModal>

    <!-- Rename API Key Modal -->
    <CommonBaseModal
        data-testid="rename-apikey-modal"
        :open="showRenameModal"
        overlay-class="items-center justify-center bg-neutral-900/40"
        panel-class="max-h-[calc(100%-3.5rem)] flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border w-full sm:max-w-lg m-3 sm:mx-auto"
        @close="closeRenameModal"
    >
                <div
                    class="nd-modal-header"
                >
                    <h3 class="font-bold text-gray-800 dark:text-gray-200">{{ $t('accountSettings.developer.renameApiKeyModal.title') }}</h3>
                    <button
                        type="button"
                        class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 transition-all text-sm"
                        @click="closeRenameModal"
                    >
                        <span class="sr-only">{{ t('common.close') }}</span>
                        <svg class="w-3.5 h-3.5" width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M0.772004 0.772004C0.907186 0.636856 1.08918 0.560669 1.279 0.560669C1.46882 0.560669 1.65081 0.636856 1.786 0.772004L6.228 5.21401C6.36315 5.34919 6.43933 5.53119 6.43933 5.72101C6.43933 5.91082 6.36315 6.09282 6.228 6.22801C6.09282 6.36315 5.91082 6.43933 5.721 6.43933C5.53119 6.43933 5.34919 6.36315 5.214 6.22801L0.772004 1.786C0.636856 1.65081 0.560669 1.46882 0.560669 1.279C0.560669 1.08918 0.636856 0.907186 0.772004 0.772004Z" fill="currentColor" />
                            <path d="M6.228 0.772004C6.36315 0.907186 6.43933 1.08918 6.43933 1.279C6.43933 1.46882 6.36315 1.65081 6.228 1.786L1.786 6.22801C1.65081 6.36315 1.46882 6.43933 1.279 6.43933C1.08918 6.43933 0.907186 6.36315 0.772004 6.22801C0.636856 6.09282 0.560669 5.91082 0.560669 5.72101C0.560669 5.53119 0.636856 5.34919 0.772004 5.21401L5.214 0.772004C5.34919 0.636856 5.53119 0.560669 5.721 0.560669C5.91082 0.560669 6.09282 0.636856 6.228 0.772004Z" fill="currentColor" />
                        </svg>
                    </button>
                </div>
                <div class="overflow-y-auto p-4">
                    <div class="flex flex-col gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {{ $t('accountSettings.developer.renameApiKeyModal.nameLabel') }}
                            </label>
                            <input
                                v-model="renameKeyName"
                                type="text"
                                class="nd-input"
                                :placeholder="$t('accountSettings.developer.renameApiKeyModal.namePlaceholder')"
                                v-on="renameKeyEnterSubmit"
                            />
                        </div>
                    </div>
                </div>
                <div
                    class="flex justify-end items-center gap-2 py-3 px-4 border-t dark:border-modal-border"
                >
                    <button
                        type="button"
                        data-testid="rename-apikey-submit"
                        class="px-4 py-2 text-sm font-medium text-white bg-button-accent-main rounded-lg hover:bg-button-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!renameKeyName || isLoading"
                        @click="confirmRenameApiKey"
                    >
                        {{ $t('accountSettings.developer.renameApiKeyModal.save') }}
                    </button>
                </div>
    </CommonBaseModal>

</template>
<style></style>
