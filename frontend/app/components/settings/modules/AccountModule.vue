<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { UserSession } from '@/stores/auth';
import type { SearchResult } from '~/types/search';
import { useToastSuccess, useToastError } from '~/utils/toast';
import { resolveContextResponse } from '~/utils/resolvers';

const { t, locale } = useI18n();

const user_store = userStore();
const labsStore = useLabsStore();
const sdk = useNadeshikoSdk();

const sessionsActionLoading = ref(false);
const sessionsError = ref('');
const deletingAccount = ref(false);
const deleteAccountError = ref('');
const loggingOut = ref(false);
const exportingData = ref(false);
const savingPreferences = ref(false);

const editingEmail = ref(false);
const newEmail = ref('');
const changingEmail = ref(false);
const changeEmailMessage = ref('');
const changeEmailError = ref('');

const requestEmailChange = async () => {
  if (changingEmail.value || !newEmail.value.trim()) return;
  changingEmail.value = true;
  changeEmailMessage.value = '';
  changeEmailError.value = '';
  try {
    const result = await user_store.changeEmail(newEmail.value.trim());
    if (result.success) {
      changeEmailMessage.value = t('accountSettings.account.changeEmailSuccess');
      editingEmail.value = false;
    } else {
      changeEmailError.value = result.error || t('accountSettings.account.changeEmailFailed');
    }
  } finally {
    changingEmail.value = false;
  }
};

const posthog = usePostHog();

const updatePreference = async (key: string, value: string) => {
  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ [key]: value });
    user_store.preferences = { ...user_store.preferences, [key]: value };
    posthog?.capture('setting_changed', { setting_name: key, value });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    console.error('Failed to update preference:', error);
    useToastError(t('accountSettings.account.preferenceError'));
  } finally {
    savingPreferences.value = false;
  }
};

const mediaNameExamples: Record<string, string> = {
  ENGLISH: 'Attack on Titan',
  JAPANESE: '進撃の巨人',
  ROMAJI: 'Shingeki no Kyojin',
};

const mediaNameLanguageLabel = computed(() => {
  const lang = user_store.preferences?.mediaNameLanguage || 'ENGLISH';
  return t(`accountSettings.account.mediaNameLanguageOptions.${lang}`);
});

const mediaNameExample = computed(() => {
  const lang = user_store.preferences?.mediaNameLanguage || 'ENGLISH';
  return mediaNameExamples[lang] ?? mediaNameExamples.ENGLISH;
});

// Content rating preview segment
const PREVIEW_SEGMENT_UUID = 'skU_sjEmsvrE';
const { data: previewData } = await useLazyAsyncData('content-rating-preview', () =>
  sdk
    .getSegmentContext({ segmentPublicId: PREVIEW_SEGMENT_UUID, take: 1 })
    .then((r) => resolveContextResponse(r))
    .catch(() => null),
);
const previewSegment = computed(() => previewData.value?.segments?.[0] ?? null);

const questionableMode = computed(() => user_store.preferences?.contentRatingPreferences?.questionable || 'BLUR');

const contentRatingDescription = (category: string) => {
  const value = user_store.preferences?.contentRatingPreferences?.[category] || 'BLUR';
  return t(`accountSettings.account.contentRatingHint_${value.toLowerCase()}`);
};

const updateMediaNameLanguage = (value: string) => updatePreference('mediaNameLanguage', value);

const { tooltipReadingMode, setTooltipReadingMode } = useTooltipReadingVisibility();

const updateContentRatingPreference = async (category: string, value: string) => {
  savingPreferences.value = true;
  try {
    const current = user_store.preferences?.contentRatingPreferences ?? {};
    const updated = { ...current, [category]: value };
    await sdk.updateUserPreferences({ contentRatingPreferences: updated });
    user_store.preferences = { ...user_store.preferences, contentRatingPreferences: updated };
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    console.error('Failed to update content rating preference:', error);
    useToastError(t('accountSettings.account.preferenceError'));
  } finally {
    savingPreferences.value = false;
  }
};

const sessionsData = ref<UserSession[]>([]);
const sessionsLoading = ref(false);
const sessionRows = computed(() => sessionsData.value);

const refreshSessions = async () => {
  sessionsLoading.value = true;
  try {
    sessionsData.value = await user_store.listSessions();
  } finally {
    sessionsLoading.value = false;
  }
};

onMounted(() => {
  void refreshSessions();
});

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(locale.value);
};

const detectDeviceType = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownDevice');

  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) return t('accountSettings.account.sessionDetails.tablet');
  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipod')) return t('accountSettings.account.sessionDetails.mobile');
  return t('accountSettings.account.sessionDetails.desktop');
};

const detectOperatingSystem = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownOs');

  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
  if (ua.includes('cros')) return 'ChromeOS';
  if (ua.includes('linux')) return 'Linux';
  return t('accountSettings.account.sessionDetails.unknownOs');
};

const detectBrowser = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownBrowser');

  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('safari/')) return 'Safari';
  return t('accountSettings.account.sessionDetails.unknownBrowser');
};

const formatUserAgent = (userAgent?: string | null) => {
  if (!userAgent) return '-';

  return [detectDeviceType(userAgent), detectOperatingSystem(userAgent), detectBrowser(userAgent)].join(' | ');
};

const isCurrentSession = (token?: string) => {
  return token && token === user_store.currentSessionToken;
};

const revokeSingleSession = async (token?: string) => {
  if (!token || sessionsActionLoading.value) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSession(token);
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeSingle');
      return;
    }

    if (user_store.isLoggedIn) {
      await refreshSessions();
    }
  } finally {
    sessionsActionLoading.value = false;
  }
};

const revokeOtherUserSessions = async () => {
  if (sessionsActionLoading.value) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeOtherSessions();
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeOthers');
      return;
    }

    await refreshSessions();
  } finally {
    sessionsActionLoading.value = false;
  }
};

const revokeAllUserSessions = async () => {
  if (sessionsActionLoading.value) return;
  if (!confirm(t('accountSettings.account.sessions.confirmRevokeAll'))) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSessions();
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeAll');
      return;
    }
  } finally {
    sessionsActionLoading.value = false;
  }
};

const exportData = async () => {
  if (exportingData.value) return;
  exportingData.value = true;
  try {
    const data = await sdk.exportUserData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nadeshiko-data-export.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[Account] Failed to export data:', error);
  } finally {
    exportingData.value = false;
  }
};

const deleteCurrentAccount = async () => {
  if (deletingAccount.value) return;
  if (!confirm(t('accountSettings.account.confirmDeleteAccount'))) return;

  deletingAccount.value = true;
  deleteAccountError.value = '';
  try {
    const success = await user_store.deleteAccount();
    if (!success) {
      deleteAccountError.value = t('accountSettings.account.deleteAccountError');
      return;
    }

    await user_store.logout(t('accountSettings.account.accountDeleted'));
  } finally {
    deletingAccount.value = false;
  }
};

const logoutCurrentUser = async () => {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await user_store.logout();
  } finally {
    loggingOut.value = false;
  }
};
</script>

<template>
  <!-- Card -->
  <div class="dark:bg-card-background p-6  mx-auto rounded-lg shadow-md">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.infoTitle') }}</h3>
      <button
        class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
        :disabled="loggingOut"
        @click="logoutCurrentUser"
      >
        {{ loggingOut ? $t('accountSettings.account.loggingOut') : $t('accountSettings.account.logout') }}
      </button>
    </div>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-gray-400">{{ $t('accountSettings.account.usernameLabel') }}</p>
          <p data-testid="account-username" class="text-white font-semibold">{{ user_store.userName || $t('accountSettings.account.notAvailable') }}</p>
        </div>
      </div>
      <div class="flex justify-between items-center mt-3">
        <div class="flex-1">
          <p class="text-gray-400">{{ $t('accountSettings.account.emailLabel') }}</p>
          <template v-if="!editingEmail">
            <p data-testid="account-email" class="text-white font-semibold">{{ user_store.userEmail || $t('accountSettings.account.notAvailable') }}</p>
          </template>
          <template v-else>
            <div class="flex items-center gap-2 mt-1">
              <input
                v-model="newEmail"
                type="email"
                :placeholder="$t('accountSettings.account.changeEmailPlaceholder')"
                class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring flex-1"
                :disabled="changingEmail"
                @keyup.enter="requestEmailChange"
              />
              <button
                class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
                :disabled="changingEmail || !newEmail.trim()"
                @click="requestEmailChange"
              >
                {{ changingEmail ? $t('accountSettings.account.changeEmailSending') : $t('accountSettings.account.changeEmailSend') }}
              </button>
              <button
                class="text-gray-400 hover:text-white text-sm font-medium py-2 px-3"
                @click="editingEmail = false; changeEmailError = ''"
              >
                {{ $t('accountSettings.account.changeEmailCancel') }}
              </button>
            </div>
          </template>
          <p v-if="changeEmailMessage" class="text-green-400 text-sm mt-1">{{ changeEmailMessage }}</p>
          <p v-if="changeEmailError" class="text-red-300 text-sm mt-1">{{ changeEmailError }}</p>
        </div>
        <button
          v-if="!editingEmail"
          class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded"
          @click="editingEmail = true; newEmail = ''; changeEmailMessage = ''; changeEmailError = ''"
        >
          {{ $t('accountSettings.account.changeEmail') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Sessions Card -->
  <div data-testid="sessions-card" class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.sessions.title') }}</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="refreshSessions()"
        >
          {{ $t('accountSettings.account.sessions.refresh') }}
        </button>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeOtherUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutOtherDevices') }}
        </button>
        <button
          class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeAllUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutAllSessions') }}
        </button>
      </div>
    </div>

    <div class="border-b pt-4 border-white/10" />

    <p v-if="sessionsError" class="mt-4 text-red-300">{{ sessionsError }}</p>
    <p v-if="sessionsLoading" data-testid="sessions-loading" class="mt-4 text-gray-300">{{ $t('accountSettings.account.sessions.loading') }}</p>

    <div v-else class="mt-4 overflow-x-auto">
      <table v-if="sessionRows.length > 0" class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.userAgent') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.created') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.expires') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="session in sessionRows" :key="session.token" :data-testid="isCurrentSession(session.token) ? 'session-row-current' : 'session-row'" :class="{ 'bg-white/5': isCurrentSession(session.token) }">
            <td class="py-3 text-sm text-gray-200">
              {{ formatUserAgent(session.userAgent) }}
              <span v-if="isCurrentSession(session.token)" class="ml-2 inline-flex items-center rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                {{ $t('accountSettings.account.sessions.current') }}
              </span>
            </td>
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.createdAt) }}</td>
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.expiresAt) }}</td>
            <td class="py-3 text-sm text-right">
              <button
                v-if="!isCurrentSession(session.token)"
                class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-1 px-3 rounded disabled:opacity-50"
                :disabled="sessionsActionLoading"
                @click="revokeSingleSession(session.token)"
              >
                {{ $t('accountSettings.account.sessions.revoke') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else data-testid="sessions-empty-state" class="text-gray-300">{{ $t('accountSettings.account.sessions.empty') }}</p>
    </div>
  </div>

  <!-- Preferences Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.preferencesTitle') }}</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.mediaNameLanguage') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.mediaNameLanguageDescription', { language: mediaNameLanguageLabel }) }} <span lang="ja" class="text-white/80 italic">{{ mediaNameExample }}</span></p>
        </div>
        <select
          :value="user_store.preferences?.mediaNameLanguage || 'ENGLISH'"
          @change="updateMediaNameLanguage(($event.target as HTMLSelectElement).value)"
          :disabled="savingPreferences"
          class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
        >
          <option value="ENGLISH">{{ $t('accountSettings.account.mediaNameLanguageOptions.ENGLISH') }}</option>
          <option value="JAPANESE">{{ $t('accountSettings.account.mediaNameLanguageOptions.JAPANESE') }}</option>
          <option value="ROMAJI">{{ $t('accountSettings.account.mediaNameLanguageOptions.ROMAJI') }}</option>
        </select>
      </div>
      <div v-if="labsStore.isFeatureEnabled('interactive-tokens')" class="flex justify-between items-center mt-4">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.tokenPopupReading') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.tokenPopupReadingDescription') }}</p>
        </div>
        <select
          :value="tooltipReadingMode"
          @change="setTooltipReadingMode(($event.target as HTMLSelectElement).value as any)"
          class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
        >
          <option value="hiragana">{{ $t('accountSettings.account.tooltipReadingOptions.hiragana') }}</option>
          <option value="katakana">{{ $t('accountSettings.account.tooltipReadingOptions.katakana') }}</option>
          <option value="romaji">{{ $t('accountSettings.account.tooltipReadingOptions.romaji') }}</option>
          <option value="hidden">{{ $t('accountSettings.account.tooltipReadingOptions.hidden') }}</option>
        </select>
      </div>

      <div class="flex justify-between items-center mt-4">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.questionableContent') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.questionableContentDesc') }}. {{ contentRatingDescription('questionable') }}</p>
        </div>
        <select
          :value="user_store.preferences?.contentRatingPreferences?.questionable || 'BLUR'"
          @change="updateContentRatingPreference('questionable', ($event.target as HTMLSelectElement).value)"
          :disabled="savingPreferences"
          class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
        >
          <option value="SHOW">{{ $t('accountSettings.account.contentRatingShow') }}</option>
          <option value="BLUR">{{ $t('accountSettings.account.contentRatingBlur') }}</option>
          <option value="HIDE">{{ $t('accountSettings.account.contentRatingHide') }}</option>
        </select>
      </div>
      <!-- Content rating visual example -->
      <div v-if="previewSegment" class="mt-3 rounded-lg bg-white/5 overflow-hidden">
        <div v-if="questionableMode === 'HIDE'" class="flex items-center justify-center py-6 px-4 bg-neutral-800">
          <span class="text-gray-500 text-sm">{{ $t('accountSettings.account.contentRatingHiddenDesc') }}</span>
        </div>
        <div v-else class="flex flex-col sm:flex-row items-stretch">
          <div class="relative h-36 sm:h-auto sm:w-48 shrink-0 overflow-hidden">
            <img
              :src="previewSegment.segment.urls.imageUrl"
              :alt="$t('accountSettings.account.contentRatingPreviewAlt')"
              class="h-full w-full object-cover object-center transition-all duration-300"
              :class="questionableMode === 'BLUR' ? 'blur-[42px] scale-125' : ''"
            />
          </div>
          <div class="flex-1 px-4 py-3 flex flex-col justify-center gap-1.5">
            <p lang="ja" class="text-white text-sm leading-snug">{{ previewSegment.segment.textJa.content }}</p>
            <p class="text-gray-400 text-xs leading-snug">{{ previewSegment.segment.textEn.content }}</p>
            <p class="text-gray-500 text-xs mt-1">{{ $t('accountSettings.account.contentRatingPreview') }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.additionalTitle') }}</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4 space-y-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.exportData') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.exportDataDescription') }}</p>
        </div>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="exportingData"
          @click="exportData"
        >
          {{ exportingData ? $t('accountSettings.account.exportingData') : $t('accountSettings.account.exportData') }}
        </button>
      </div>
      <div class="flex justify-between items-center">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.deleteAccount') }}</p>
        </div>
        <button
          class="bg-button-accent-main hover:bg-button-accent-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="deletingAccount"
          @click="deleteCurrentAccount"
        >
          {{ deletingAccount ? $t('accountSettings.account.deletingAccount') : $t('accountSettings.account.deleteAccountButton') }}
        </button>
      </div>
      <p v-if="deleteAccountError" class="text-red-300 text-sm mt-2">{{ deleteAccountError }}</p>
    </div>
  </div>
</template>
