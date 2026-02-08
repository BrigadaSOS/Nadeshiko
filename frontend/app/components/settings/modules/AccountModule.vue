<script setup>
// Language configuration
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const user_store = userStore();
const dataUser = ref(null);
const isLoading = ref(false);
const error = ref(null);
const userInfo = ref(null);
const isAuth = computed(() => user_store.isLoggedIn);

const sessionRows = ref([]);
const sessionsLoading = ref(false);
const sessionsActionLoading = ref(false);
const sessionsError = ref('');
const deletingAccount = ref(false);

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const detectDeviceType = (userAgent) => {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) return 'Tablet';
  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipod')) return 'Mobile';
  return 'Desktop';
};

const detectOperatingSystem = (userAgent) => {
  if (!userAgent) return 'Unknown OS';

  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
  if (ua.includes('cros')) return 'ChromeOS';
  if (ua.includes('linux')) return 'Linux';
  return 'Unknown OS';
};

const detectBrowser = (userAgent) => {
  if (!userAgent) return 'Unknown browser';

  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('safari/')) return 'Safari';
  return 'Unknown browser';
};

const formatUserAgent = (userAgent) => {
  if (!userAgent) return '-';

  return [detectDeviceType(userAgent), detectOperatingSystem(userAgent), detectBrowser(userAgent)].join(' | ');
};

const getUserInfo = async () => {
  isLoading.value = true;
  try {
    userInfo.value = await user_store.getBasicInfo();
    dataUser.value = userInfo.value;
    error.value = null;
  } catch (e) {
    error.value = t('accountSettings.account.dataLoadError');
    console.error(e);
  } finally {
    isLoading.value = false;
  }
};

const loadSessions = async () => {
  if (!isAuth.value) {
    sessionRows.value = [];
    return;
  }

  sessionsLoading.value = true;
  sessionsError.value = '';
  try {
    sessionRows.value = await user_store.listSessions();
  } catch (e) {
    sessionsError.value = 'Unable to load active sessions.';
    console.error(e);
  } finally {
    sessionsLoading.value = false;
  }
};

const revokeSingleSession = async (token) => {
  if (!token || sessionsActionLoading.value) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSession(token);
    if (!success) {
      sessionsError.value = 'Unable to revoke this session. Please sign in again and retry.';
      return;
    }

    await user_store.getBasicInfo();
    if (user_store.isLoggedIn) {
      await loadSessions();
    } else {
      sessionRows.value = [];
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
      sessionsError.value = 'Unable to revoke other sessions. Please sign in again and retry.';
      return;
    }

    await loadSessions();
  } finally {
    sessionsActionLoading.value = false;
  }
};

const revokeAllUserSessions = async () => {
  if (sessionsActionLoading.value) return;
  if (!confirm('This will revoke all your sessions, including this one. Continue?')) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSessions();
    if (!success) {
      sessionsError.value = 'Unable to revoke all sessions. Please sign in again and retry.';
      return;
    }
  } finally {
    sessionsActionLoading.value = false;
  }
};

const deleteCurrentAccount = async () => {
  if (deletingAccount.value) return;
  if (!confirm('This action permanently deletes your account. Continue?')) return;

  deletingAccount.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.deleteAccount();
    if (!success) {
      sessionsError.value = 'Unable to delete account. You may need to sign in again and retry.';
      return;
    }

    await user_store.logout('Account deleted');
  } finally {
    deletingAccount.value = false;
  }
};

onMounted(async () => {
  if (isAuth.value && isAuth.value != null) {
    await getUserInfo();
    await loadSessions();
  }
});
</script>

<template>
  <!-- Card -->
  <div class="dark:bg-card-background p-6  mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.infoTitle') }}</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-gray-400">{{ $t('accountSettings.account.usernameLabel') }}</p>
          <div v-if="isLoading">
            <div class="w-32 h-4 mt-2 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.user?.username || $t('accountSettings.account.notAvailable') }}</p>
        </div>
      </div>
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-gray-400">{{ $t('accountSettings.account.emailLabel') }}</p>
          <div v-if="isLoading">
            <div class="w-40 h-4 mt-2 bg-gray-200 rounded-lg dark:bg-sgray"></div>
          </div>
          <p v-else class="text-white font-semibold">{{ dataUser?.user?.email || $t('accountSettings.account.notAvailable') }}</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Sessions Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">Sessions</h3>
      <div class="flex flex-wrap gap-2">
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="loadSessions"
        >
          Refresh
        </button>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeOtherUserSessions"
        >
          Log Out Other Devices
        </button>
        <button
          class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeAllUserSessions"
        >
          Log Out All Sessions
        </button>
      </div>
    </div>

    <div class="border-b pt-4 border-white/10" />

    <p v-if="sessionsError" class="mt-4 text-red-300">{{ sessionsError }}</p>
    <p v-if="sessionsLoading" class="mt-4 text-gray-300">Loading sessions...</p>

    <div v-else class="mt-4 overflow-x-auto">
      <table v-if="sessionRows.length > 0" class="min-w-full divide-y divide-gray-200 dark:divide-white/20">
        <thead>
          <tr>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">IP</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">User Agent</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Created</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase">Expires</th>
            <th class="py-2 text-left text-xs font-medium text-white/90 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr v-for="session in sessionRows" :key="session.token">
            <td class="py-3 text-sm text-gray-200">{{ session.ipAddress || '-' }}</td>
            <td class="py-3 text-sm text-gray-200">{{ formatUserAgent(session.userAgent) }}</td>
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.createdAt) }}</td>
            <td class="py-3 text-sm text-gray-200">{{ formatDate(session.expiresAt) }}</td>
            <td class="py-3 text-sm text-right">
              <button
                class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-1 px-3 rounded disabled:opacity-50"
                :disabled="sessionsActionLoading"
                @click="revokeSingleSession(session.token)"
              >
                Revoke
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="text-gray-300">No active sessions found.</p>
    </div>
  </div>

  <!-- Card -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.account.additionalTitle') }}</h3>
    <div class="border-b pt-4 border-white/10" />
    <div class="mt-4">
      <div class="flex justify-between items-center mt-3">
        <div>
          <p class="text-white">{{ $t('accountSettings.account.deleteAccount') }}</p>
        </div>
        <button
          class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="deletingAccount"
          @click="deleteCurrentAccount"
        >
          {{ deletingAccount ? 'Deleting...' : 'Delete account' }}
        </button>
      </div>
    </div>
  </div>
</template>
