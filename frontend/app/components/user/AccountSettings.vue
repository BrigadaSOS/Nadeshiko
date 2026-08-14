<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { NadeshikoError, type Category, type UserPreferences } from '@brigadasos/nadeshiko-sdk';

import { ALL_CATEGORIES, CATEGORY_LABEL_KEYS } from '~/utils/categories';
import { MOTION_LEVELS, type MotionLevel } from '~/composables/useMotionPreference';

import type { UserSession } from '@/stores/auth';
import type { SearchResult } from '~/types/search';
import { useToastSuccess } from '~/utils/toast';
import { handleApiError } from '~/utils/apiError';
import { resolveContextResponse } from '~/utils/resolvers';
import { reportError } from '~/utils/reportError';

const { t } = useI18n();
const { formatDate } = useFormat();

const user_store = userStore();
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
    handleApiError('account:preference-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': key },
    });
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

// Content rating preview segment.
//
// A hand-picked segment, so it can be retired from the catalogue without anyone
// touching this file -- and it was: `skU_sjEmsvrE` started 404ing some time
// before 2026-08-11 and took the preview card with it. Silently, because the
// card is behind `v-if="previewSegment"`. What was NOT silent was the report
// below, which fired on every settings visit and became the top unexplained
// issue in error tracking (`NadeshikoError: Segment not found`).
//
// So a 404 here is an expected end-of-life for a curated id, not an incident:
// it is left unreported and the card just does not render. Anything else (5xx,
// network, a malformed body) is still a real failure and still reported.
const PREVIEW_SEGMENT_UUID = 'skU_sjEmsvrE';
const { data: previewData } = await useLazyAsyncData('content-rating-preview', () =>
  sdk
    .getSegmentContext({ segmentPublicId: PREVIEW_SEGMENT_UUID, take: 1 })
    .then((r) => resolveContextResponse(r))
    // Decorative preview for the content-rating setting: the panel renders fine
    // without it, so a failure must not interrupt the settings page.
    .catch((error: unknown) => {
      const retired = error instanceof NadeshikoError && error.status === 404;
      if (!retired) {
        reportError('account:content-rating-preview-failed', error);
      }
      return null;
    }),
);
const previewSegment = computed(() => previewData.value?.segments?.[0] ?? null);

const questionableMode = computed(() => user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR');

const contentRatingDescription = () => {
  const value = user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR';
  return t(`accountSettings.account.contentRatingHint_${value.toLowerCase()}`);
};

const updateMediaNameLanguage = (value: string) => updatePreference('mediaNameLanguage', value);

const { preference: motionPreference, setPreference: setMotionPreference } = useMotionPreference();

const { storedDefault: defaultSearchCategory, isDefaultCategoryHidden } = useDefaultSearchCategory();
const { isCategoryHidden } = useHiddenCategories();

const categoryLabel = (category: Category) => t(CATEGORY_LABEL_KEYS[category]);

// A category hidden wholesale is still offered, and still stores: the two
// settings live on different pages, and refusing the choice here would read as a
// broken select rather than as a consequence of Hide Categories. It is labelled
// as hidden, and picking one only means searches open on All until it is shown
// again.
const defaultCategoryOptionLabel = (category: Category) =>
  isCategoryHidden(category)
    ? t('accountSettings.account.defaultSearchCategoryHiddenOption', { category: categoryLabel(category) })
    : categoryLabel(category);

const hiddenDefaultCategoryNotice = computed(() => {
  const stored = defaultSearchCategory.value;
  if (stored === 'ALL' || !isDefaultCategoryHidden.value) return null;
  return t('accountSettings.account.defaultSearchCategoryHiddenNotice', { category: categoryLabel(stored) });
});

const updateDefaultSearchCategory = (value: string) => updatePreference('defaultSearchCategory', value);

const { presets: dictionaryPresets, isDictionaryEnabled, setDictionaryEnabled } = useDictionaryLinks();

type NsfwMode = NonNullable<NonNullable<UserPreferences['contentRatingPreferences']>['nsfw']>;

const updateContentRatingPreference = async (value: NsfwMode) => {
  savingPreferences.value = true;
  try {
    const current = user_store.preferences?.contentRatingPreferences ?? {};
    const updated = { ...current, nsfw: value };
    await sdk.updateUserPreferences({ contentRatingPreferences: updated });
    user_store.preferences = { ...user_store.preferences, contentRatingPreferences: updated };
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:content-rating-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
    });
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

const detectDeviceType = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownDevice');

  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) return t('accountSettings.account.sessionDetails.tablet');
  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipod'))
    return t('accountSettings.account.sessionDetails.mobile');
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
    // The download simply never starts otherwise, with nothing on screen to say why.
    handleApiError('account:data-export-failed', error, { toastKey: 'accountSettings.account.exportError' });
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
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.createdAt, 'dateTime') }}</td>
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.expiresAt, 'dateTime') }}</td>
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
      <div class="mt-4">
        <div class="flex justify-between items-center gap-4">
          <div>
            <p class="text-white">{{ $t('accountSettings.account.defaultSearchCategory') }}</p>
            <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.defaultSearchCategoryDescription') }}</p>
          </div>
          <select
            data-testid="default-search-category"
            :value="defaultSearchCategory"
            @change="updateDefaultSearchCategory(($event.target as HTMLSelectElement).value)"
            :disabled="savingPreferences"
            class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
          >
            <option value="ALL">{{ $t('searchContainer.categoryAll') }}</option>
            <option v-for="category in ALL_CATEGORIES" :key="category" :value="category">
              {{ defaultCategoryOptionLabel(category) }}
            </option>
          </select>
        </div>
        <p v-if="hiddenDefaultCategoryNotice" class="text-amber-300/80 text-sm mt-2">{{ hiddenDefaultCategoryNotice }}</p>
      </div>

      <!-- Motion lives in a cookie rather than the stored preferences, so it
           applies the moment it is picked and needs no round trip -- and so it
           is already right in the server's first render. `savingPreferences`
           therefore does not gate it. -->
      <div class="mt-4">
        <div class="flex justify-between items-center gap-4">
          <div>
            <p class="text-white">{{ $t('accountSettings.account.motion') }}</p>
            <p class="text-gray-400 text-sm">{{ $t(`accountSettings.account.motionHint_${motionPreference}`) }}</p>
          </div>
          <select
            data-testid="motion-preference"
            :value="motionPreference"
            @change="setMotionPreference(($event.target as HTMLSelectElement).value as MotionLevel)"
            class="bg-neutral-800 text-white border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-input-focus-ring focus:border-input-focus-ring"
          >
            <option v-for="option in MOTION_LEVELS" :key="option" :value="option">
              {{ $t(`accountSettings.account.motionOptions.${option}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="mt-4">
        <p class="text-white">{{ $t('accountSettings.account.dictionaryLinks') }}</p>
        <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.dictionaryLinksDescription') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <label
            v-for="preset in dictionaryPresets"
            :key="preset.id"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-800 border border-white/10 text-sm text-white"
            :class="preset.required ? 'opacity-70 cursor-default' : 'cursor-pointer hover:bg-neutral-700'"
          >
            <input
              type="checkbox"
              :checked="isDictionaryEnabled(preset.id)"
              :disabled="preset.required"
              class="accent-button-primary-main"
              @change="setDictionaryEnabled(preset.id, ($event.target as HTMLInputElement).checked)"
            />
            <!-- A required dictionary is a checked, disabled box and nothing
                 else: the control already says it cannot be turned off, and the
                 label spelled out in words what the disabled state shows. -->
            <span>{{ preset.label }}</span>
          </label>
        </div>
      </div>

      <div class="flex justify-between items-center mt-4">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.questionableContent') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.questionableContentDesc') }}. {{ contentRatingDescription() }}</p>
        </div>
        <select
          :value="user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR'"
          @change="updateContentRatingPreference(($event.target as HTMLSelectElement).value as NsfwMode)"
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
