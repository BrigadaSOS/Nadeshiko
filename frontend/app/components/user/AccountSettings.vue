<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { Category, UserPreferences } from '@brigadasos/nadeshiko-sdk';

import { apiErrorStatus } from '~/utils/apiError';
import { ALL_CATEGORIES, CATEGORY_LABEL_KEYS } from '~/utils/categories';
import { MOTION_LEVELS, type MotionLevel } from '~/composables/useMotionPreference';
import { normalizeTranslationLanguages, type TranslationLanguage } from '~/composables/useTranslationLanguages';

import type { UserSession } from '@/stores/auth';
import type { SearchResult } from '~/types/search';
import { useToastSuccess } from '~/utils/toast';
import { handleApiError } from '~/utils/apiError';
import { DEFINITION_SIZES, definitionSize } from '~/utils/wordPopup';
import { resolveContextResponse } from '~/utils/resolvers';
// Explicit, because Nuxt's auto-import names a component after its directory:
// this one is `UserConnectionsCard`, and `<ConnectionsCard />` would have
// resolved to nothing and rendered nothing, silently.
import ConnectionsCard from '~/components/user/ConnectionsCard.vue';
import { reportError } from '~/utils/reportError';

const { t, locale } = useI18n();
const { formatDate } = useFormat();

const user_store = userStore();

// Whether this reader's definitions come from their own Shirabe stack, which is
// what makes the dictionary half of the languages setting somebody else's
// business. Read off the session, so it costs no extra request.
const shirabeLinked = computed(() => (user_store.shirabeGlossLanguages ?? []).length > 0);

/** How large the word card prints its definitions. See `~/utils/wordPopup`. */
const definitionTextSize = computed(() => definitionSize(user_store.preferences?.wordPopup?.definitionSize));

const updateDefinitionSize = async (value: string) => {
  const size = definitionSize(value);

  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ wordPopup: { definitionSize: size } });
    user_store.preferences = {
      ...user_store.preferences,
      wordPopup: { ...user_store.preferences?.wordPopup, definitionSize: size },
    };
    posthog?.capture('setting_changed', { setting_name: 'wordPopup.definitionSize', value: size });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:definition-size-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'wordPopup.definitionSize' },
    });
  } finally {
    savingPreferences.value = false;
  }
};
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
const productEmailsEnabled = ref(user_store.preferences?.productEmails?.enabled !== false);
const togglingProductEmails = ref(false);

/**
 * The finer grain under the master switch.
 *
 * ABSENT MEANS FOLLOW THE MASTER, which is why these read `!== false` rather
 * than defaulting to `true`: a reader who has never touched them has no opinion
 * stored, and the server treats that silence as "whatever `enabled` says". A
 * checkbox that showed them as explicitly on would be inventing a decision they
 * never made.
 */
const EMAIL_CATEGORIES = ['recap', 'checkins', 'updates'] as const;
type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

const emailCategories = reactive(
  Object.fromEntries(
    EMAIL_CATEGORIES.map((key) => [key, user_store.preferences?.productEmails?.[key] !== false]),
  ) as Record<EmailCategory, boolean>,
);
const togglingCategory = ref<EmailCategory | null>(null);
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

/**
 * One category on or off, leaving the master and the others alone.
 *
 * Sends only the key that changed, merged over what is already stored, because
 * the whole `productEmails` object is rewritten on every write -- posting a
 * fresh object built from local state would silently clear anything set on
 * another device since this page loaded.
 */
const toggleEmailCategory = async (category: EmailCategory) => {
  if (togglingCategory.value) return;
  togglingCategory.value = category;
  const newValue = !emailCategories[category];

  const productEmails = { ...(user_store.preferences?.productEmails ?? {}), [category]: newValue };

  try {
    await sdk.updateUserPreferences({ productEmails });
    emailCategories[category] = newValue;
    user_store.preferences = { ...(user_store.preferences ?? {}), productEmails };
    usePostHog()?.capture('setting_changed', { setting_name: `productEmails.${category}`, value: newValue });
  } catch (error) {
    handleApiError('account:product-emails-category-failed', error, {
      toastKey: 'accountSettings.emails.preferenceError',
      context: { 'preference.key': `productEmails.${category}` },
    });
  } finally {
    togglingCategory.value = null;
  }
};

/**
 * The same switch the unsubscribe link in every lifecycle email flips.
 *
 * Governs only that mail -- the day-7 note, the feedback ask, the monthly
 * recap. Sign-in links and address verification are unaffected and deliberately
 * have no switch: an account you cannot receive mail for is one you cannot get
 * back into. The copy under the toggle says so, because a reader turning this
 * off has no other way to know it is safe.
 */
const toggleProductEmails = async () => {
  if (togglingProductEmails.value) return;
  togglingProductEmails.value = true;
  const newValue = !productEmailsEnabled.value;
  try {
    const productEmails = { ...(user_store.preferences?.productEmails ?? {}), enabled: newValue };
    await sdk.updateUserPreferences({ productEmails });
    productEmailsEnabled.value = newValue;
    // Written through to the store for the same reason the activity toggles do
    // it: the initial value above reads from there, so leaving the page and
    // coming back would otherwise show the old state.
    user_store.preferences = { ...(user_store.preferences ?? {}), productEmails };
    usePostHog()?.capture('setting_changed', { setting_name: 'productEmails', value: newValue });
    useToastSuccess(
      t(newValue ? 'accountSettings.account.productEmailsOnToast' : 'accountSettings.account.productEmailsOffToast'),
    );
  } catch (error) {
    handleApiError('account:product-emails-toggle-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'productEmails' },
    });
  } finally {
    togglingProductEmails.value = false;
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
      const retired = apiErrorStatus(error) === 404;
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

const translationLanguageSelection = computed(() =>
  normalizeTranslationLanguages(user_store.preferences?.translationLanguages, locale.value).join(','),
);

const updateTranslationLanguages = async (value: string) => {
  const languages = value
    .split(',')
    .filter((language): language is TranslationLanguage => language === 'EN' || language === 'ES');
  if (languages.length === 0) return;

  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ translationLanguages: languages });
    user_store.preferences = { ...user_store.preferences, translationLanguages: languages };
    posthog?.capture('setting_changed', { setting_name: 'translationLanguages', value: languages.join(',') });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:translation-languages-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'translationLanguages' },
    });
  } finally {
    savingPreferences.value = false;
  }
};

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
  <div class="nd-settings-card">
    <div class="flex items-center justify-between gap-2">
      <h3 class="nd-settings-title">{{ $t('accountSettings.account.infoTitle') }}</h3>
      <button
        class="nd-btn-accent"
        :disabled="loggingOut"
        @click="logoutCurrentUser"
      >
        {{ loggingOut ? $t('accountSettings.account.loggingOut') : $t('accountSettings.account.logout') }}
      </button>
    </div>
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
                class="nd-select flex-1"
                :disabled="changingEmail"
                @keyup.enter="requestEmailChange"
              />
              <button
                class="nd-btn"
                :disabled="changingEmail || !newEmail.trim()"
                @click="requestEmailChange"
              >
                {{ changingEmail ? $t('accountSettings.account.changeEmailSending') : $t('accountSettings.account.changeEmailSend') }}
              </button>
              <button
                class="nd-btn"
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
          class="nd-btn"
          @click="editingEmail = true; newEmail = ''; changeEmailMessage = ''; changeEmailError = ''"
        >
          {{ $t('accountSettings.account.changeEmail') }}
        </button>
      </div>

    </div>
  </div>

  <!-- Sessions Card -->
  <div data-testid="sessions-card" class="nd-settings-card">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="nd-settings-title">{{ $t('accountSettings.account.sessions.title') }}</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="nd-btn"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="refreshSessions()"
        >
          {{ $t('accountSettings.account.sessions.refresh') }}
        </button>
        <button
          class="nd-btn"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeOtherUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutOtherDevices') }}
        </button>
        <button
          class="nd-btn-accent"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeAllUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutAllSessions') }}
        </button>
      </div>
    </div>

    <p v-if="sessionsError" class="mt-4 text-red-300">{{ sessionsError }}</p>
    <p v-if="sessionsLoading" data-testid="sessions-loading" class="mt-4 text-gray-300">{{ $t('accountSettings.account.sessions.loading') }}</p>

    <!-- Below `md` a session is a block: the device on its own line, then the
         two dates labelled (the header that named them is gone), then Revoke.
         Two full timestamps and a user agent will not share a phone's width. -->
    <div v-else class="mt-4 md:overflow-x-auto">
      <table v-if="sessionRows.length > 0" class="block w-full md:table md:min-w-full md:divide-y md:divide-gray-200 md:dark:divide-white/20">
        <thead class="hidden md:table-header-group">
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.userAgent') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.created') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.account.sessions.table.expires') }}</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="block md:table-row-group md:divide-y md:divide-gray-200 md:dark:divide-white/10">
          <tr v-for="session in sessionRows" :key="session.token" :data-testid="isCurrentSession(session.token) ? 'session-row-current' : 'session-row'" :class="['flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 py-3 last:border-0 md:table-row md:border-0 md:py-0', { 'bg-white/5': isCurrentSession(session.token) }]">
            <td class="order-1 w-full min-w-0 break-words text-sm text-gray-200 md:w-auto md:table-cell md:py-3">
              {{ formatUserAgent(session.userAgent) }}
              <span v-if="isCurrentSession(session.token)" class="ml-2 inline-flex items-center rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                {{ $t('accountSettings.account.sessions.current') }}
              </span>
            </td>
            <td class="order-2 text-xs text-gray-400 md:table-cell md:py-3 md:text-sm md:text-gray-200">
              <span class="md:hidden">{{ $t('accountSettings.account.sessions.table.created') }}: </span>{{ formatDate(session.createdAt, 'dateTime') }}
            </td>
            <td class="order-3 w-full text-xs text-gray-400 md:w-auto md:table-cell md:py-3 md:text-sm md:text-gray-200">
              <span class="md:hidden">{{ $t('accountSettings.account.sessions.table.expires') }}: </span>{{ formatDate(session.expiresAt, 'dateTime') }}
            </td>
            <td class="order-4 ml-auto text-sm md:ml-0 md:table-cell md:py-3 md:text-right">
              <button
                v-if="!isCurrentSession(session.token)"
                class="nd-btn-accent"
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
  <div class="nd-settings-card">
    <h3 class="nd-settings-title">{{ $t('accountSettings.account.preferencesTitle') }}</h3>
    <div class="mt-4">
      <div class="nd-settings-row">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.mediaNameLanguage') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.mediaNameLanguageDescription', { language: mediaNameLanguageLabel }) }} <span lang="ja" class="text-white/80 italic">{{ mediaNameExample }}</span></p>
        </div>
        <select
          :value="user_store.preferences?.mediaNameLanguage || 'ENGLISH'"
          @change="updateMediaNameLanguage(($event.target as HTMLSelectElement).value)"
          :disabled="savingPreferences"
          class="nd-select"
        >
          <option value="ENGLISH">{{ $t('accountSettings.account.mediaNameLanguageOptions.ENGLISH') }}</option>
          <option value="JAPANESE">{{ $t('accountSettings.account.mediaNameLanguageOptions.JAPANESE') }}</option>
          <option value="ROMAJI">{{ $t('accountSettings.account.mediaNameLanguageOptions.ROMAJI') }}</option>
        </select>
      </div>
      <div class="mt-4">
        <div class="nd-settings-row">
          <div>
            <p class="text-white">{{ $t('accountSettings.account.defaultSearchCategory') }}</p>
            <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.defaultSearchCategoryDescription') }}</p>
          </div>
          <select
            data-testid="default-search-category"
            :value="defaultSearchCategory"
            @change="updateDefaultSearchCategory(($event.target as HTMLSelectElement).value)"
            :disabled="savingPreferences"
            class="nd-select"
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
        <div class="nd-settings-row">
          <div>
            <p class="text-white">{{ $t('accountSettings.account.motion') }}</p>
            <p class="text-gray-400 text-sm">{{ $t(`accountSettings.account.motionHint_${motionPreference}`) }}</p>
          </div>
          <select
            data-testid="motion-preference"
            :value="motionPreference"
            @change="setMotionPreference(($event.target as HTMLSelectElement).value as MotionLevel)"
            class="nd-select"
          >
            <option v-for="option in MOTION_LEVELS" :key="option" :value="option">
              {{ $t(`accountSettings.account.motionOptions.${option}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="nd-settings-row mt-4">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.questionableContent') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.questionableContentDesc') }}. {{ contentRatingDescription() }}</p>
        </div>
        <select
          :value="user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR'"
          @change="updateContentRatingPreference(($event.target as HTMLSelectElement).value as NsfwMode)"
          :disabled="savingPreferences"
          class="nd-select"
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

      <!-- The two dictionary rows sit last, together, and directly above the
           Shirabe card below: all three are about where a word's definitions
           come from, and they were scattered through the list with unrelated
           settings between them. -->
      <div class="mt-4">
        <p class="text-white">{{ $t('accountSettings.account.dictionaryLinks') }}</p>
        <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.dictionaryLinksDescription') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <label
            v-for="preset in dictionaryPresets"
            :key="preset.id"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-control border border-hairline text-sm text-ink-faint"
            :class="preset.required ? 'opacity-70 cursor-default' : 'cursor-pointer hover:bg-control-hover hover:text-ink'"
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

      <!-- The word card's own settings, beside the two dictionary rows: all of
           it is about what happens when a reader taps a word. -->
      <div class="mt-4 nd-settings-row">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.definitionSize') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.definitionSizeDescription') }}</p>
        </div>
        <select
          data-testid="definition-size"
          :value="definitionTextSize"
          :disabled="savingPreferences"
          class="nd-select"
          @change="updateDefinitionSize(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="size in DEFINITION_SIZES" :key="size" :value="size">
            {{ $t(`accountSettings.account.definitionSizeOptions.${size}`) }}
          </option>
        </select>
      </div>

      <div class="mt-4 nd-settings-row">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.translationLanguages') }}</p>
          <!-- The description changes when a Shirabe account is linked, because
               half of what this control did moved over there. It is NOT disabled
               with it: the same value still decides which subtitle translation
               rows render under a sentence, which EN/ES toggles search offers,
               and which translations the segment menu copies -- none of which
               Shirabe has any opinion about. -->
          <p class="text-gray-400 text-sm">{{ $t(shirabeLinked ? 'accountSettings.account.translationLanguagesLinkedDescription' : 'accountSettings.account.translationLanguagesDescription') }}</p>
        </div>
        <select
          data-testid="translation-languages"
          :value="translationLanguageSelection"
          :disabled="savingPreferences"
          class="nd-select"
          @change="updateTranslationLanguages(($event.target as HTMLSelectElement).value)"
        >
          <option value="EN">{{ $t('accountSettings.account.translationLanguageOptions.EN') }}</option>
          <option value="ES">{{ $t('accountSettings.account.translationLanguageOptions.ES') }}</option>
          <option value="EN,ES">{{ $t('accountSettings.account.translationLanguageOptions.EN_ES') }}</option>
          <option value="ES,EN">{{ $t('accountSettings.account.translationLanguageOptions.ES_EN') }}</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Below preferences because that is what it is: which dictionaries the word
       card answers from, decided on another site the reader has an account on. -->
  <ConnectionsCard />


  <!-- Below connections, because this is the last thing about the account that
       is a preference rather than an action -- what we may send, before the card
       that offers to export or delete everything. -->
  <div data-testid="emails-card" class="nd-settings-card">
    <h3 class="nd-settings-title">{{ $t('accountSettings.emails.title') }}</h3>

    <div class="mt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">{{ $t('accountSettings.emails.allTitle') }}</p>
        </div>
        <button
          data-testid="product-emails-toggle"
          :disabled="togglingProductEmails"
          :aria-pressed="productEmailsEnabled"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            productEmailsEnabled ? 'bg-red-500' : 'bg-gray-600',
          ]"
          @click="toggleProductEmails"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              productEmailsEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <!-- Dimmed rather than hidden when the master is off: a reader needs to
           see what they would get back before turning it on again. -->
      <div
        :class="[
          'space-y-4 pt-4 border-t border-gray-700 transition-opacity',
          productEmailsEnabled ? '' : 'opacity-50',
        ]"
      >
        <div v-for="category in EMAIL_CATEGORIES" :key="category" class="flex items-center justify-between gap-4">
          <div>
            <p class="text-white">{{ $t(`accountSettings.emails.${category}Title`) }}</p>
            <p class="text-gray-400 text-sm">{{ $t(`accountSettings.emails.${category}Description`) }}</p>
          </div>
          <button
            :data-testid="`email-category-${category}`"
            :disabled="!productEmailsEnabled || togglingCategory !== null"
            :aria-pressed="productEmailsEnabled && emailCategories[category]"
            :class="[
              'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
              productEmailsEnabled ? 'cursor-pointer' : 'cursor-not-allowed',
              productEmailsEnabled && emailCategories[category] ? 'bg-red-500' : 'bg-gray-600',
            ]"
            @click="toggleEmailCategory(category)"
          >
            <span
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                productEmailsEnabled && emailCategories[category] ? 'translate-x-5' : 'translate-x-0',
              ]"
            />
          </button>
        </div>
      </div>

      <p class="text-gray-500 text-sm pt-2">{{ $t('accountSettings.emails.transactionalNote') }}</p>
    </div>
  </div>

  <!-- Card -->
  <div class="nd-settings-card">
    <h3 class="nd-settings-title">{{ $t('accountSettings.account.additionalTitle') }}</h3>
    <div class="mt-4 space-y-4">
      <div class="nd-settings-row">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.exportData') }}</p>
          <p class="text-gray-400 text-sm">{{ $t('accountSettings.account.exportDataDescription') }}</p>
        </div>
        <button
          class="nd-btn"
          :disabled="exportingData"
          @click="exportData"
        >
          {{ exportingData ? $t('accountSettings.account.exportingData') : $t('accountSettings.account.exportData') }}
        </button>
      </div>
      <div class="nd-settings-row">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.deleteAccount') }}</p>
        </div>
        <button
          class="nd-btn-accent"
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
