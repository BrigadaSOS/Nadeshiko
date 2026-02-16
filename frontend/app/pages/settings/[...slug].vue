<script setup>
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { mdiAccount, mdiSync, mdiCodeTags, mdiFlask, mdiHistory, mdiShieldCrownOutline } from '@mdi/js';
import SettingsAccountModule from '../../components/settings/modules/AccountModule.vue';
import SettingsAnkiModule from '../../components/settings/modules/AnkiModule.vue';
import SettingsDeveloperModule from '../../components/settings/modules/DeveloperModule.vue';
import SettingsLabsModule from '../../components/settings/modules/LabsModule.vue';
import SettingsActivityModule from '../../components/settings/modules/ActivityModule.vue';
import SettingsReportsModule from '../../components/settings/modules/ReportsModule.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const store = userStore();
const isAuth = computed(() => store.isLoggedIn);
const isMounted = ref(false);
const isAuthReady = computed(() => isMounted.value && isAuth.value);

const tabs_general = [
  { name: t('accountSettings.tabs.account'), icon: mdiAccount, route: '/settings/account', requiresAuth: true },
  { name: t('accountSettings.tabs.sync'), icon: mdiSync, route: '/settings/sync', requiresAuth: false },
  { name: 'Activity', icon: mdiHistory, route: '/settings/activity', requiresAuth: true },
];
const tabs_advanced = [
  { name: t('accountSettings.tabs.developer'), icon: mdiCodeTags, route: '/settings/developer' },
  { name: 'Labs', icon: mdiFlask, route: '/settings/labs' },
];
const tabs_admin = [{ name: 'Reports', icon: mdiShieldCrownOutline, route: '/settings/reports' }];

const activeTab = ref('');

watch(
  () => route.path,
  (newPath) => {
    if (newPath === '/settings' || newPath.startsWith('/settings/account')) {
      activeTab.value = '#horizontal-scroll-tab-cuenta';
    } else if (newPath.startsWith('/settings/sync')) {
      activeTab.value = '#horizontal-scroll-tab-sincronización-anki';
    } else if (newPath.startsWith('/settings/developer')) {
      activeTab.value = '#horizontal-scroll-tab-desarrollador';
    } else if (newPath.startsWith('/settings/activity')) {
      activeTab.value = '#horizontal-scroll-tab-activity';
    } else if (newPath.startsWith('/settings/labs')) {
      activeTab.value = '#horizontal-scroll-tab-labs';
    } else if (newPath.startsWith('/settings/reports')) {
      activeTab.value = '#horizontal-scroll-tab-reports';
    }
  },
  { immediate: true },
);

const navigateToTab = (path) => {
  router.push(path);
};

onMounted(() => {
  isMounted.value = true;
});

definePageMeta({
  middleware: defineNuxtRouteMiddleware((to) => {
    const store = userStore();
    if (store.isLoggedIn) {
      // Logged-in users hitting bare /settings → default to account
      if (to.path === '/settings') {
        return navigateTo('/settings/account', { replace: true });
      }
      // Admin-only routes
      if (to.path.startsWith('/settings/reports') && !store.isAdmin) {
        return navigateTo('/settings/account', { replace: true });
      }
      return;
    }
    // Not logged in: only /settings/sync is allowed
    if (to.path.startsWith('/settings/sync')) {
      return;
    }
    return navigateTo('/', { replace: true });
  }),
});
</script>

<template>
    <NuxtLayout> 
    <div class="w-11/12 mx-auto my-2 text-white min-h-screen">
        <div class="flex flex-col md:flex-row">
            <!-- Vertical Tabs -->
            <div class="hidden mx-auto md:block md:sticky top-0 md:h-screen md:overflow-y-auto md:w-1/4 xl:w-3/12">
                <nav aria-label="Tabs" class="flex flex-col dark:bg-card-background rounded-lg p-6 my-2 space-y-2">
                    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.generalTitle") }}</h3>
                    <div class="border-b border-white/10" />
                    <button v-for="tab in tabs_general" :key="tab.name"
                        :class="{
                            'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`,
                            'opacity-50 cursor-not-allowed': !isAuthReady && tab.requiresAuth
                        }"
                        :disabled="!isAuthReady && tab.requiresAuth"
                        @click="(!tab.requiresAuth || isAuthReady) ? navigateToTab(tab.route) : null"
                        class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
                        <UiBaseIcon :path="tab.icon" size="20" />
                        {{ tab.name }}
                    </button>

                    <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.advancedTitle") }}</h3>
                    <div class="border-b border-white/10" />
                    <button v-for="tab in tabs_advanced" :key="tab.name"
                        :class="{
                            'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`,
                            'opacity-50 cursor-not-allowed': !isAuthReady
                        }"
                        :disabled="!isAuthReady"
                        @click="isAuthReady ? navigateToTab(tab.route) : null"
                        class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
                        <UiBaseIcon :path="tab.icon" size="20" />
                        {{ tab.name }}
                    </button>

                    <template v-if="store.isAdmin">
                        <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">Admin</h3>
                        <div class="border-b border-white/10" />
                        <button v-for="tab in tabs_admin" :key="tab.name"
                            @click="navigateToTab(tab.route)"
                            class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
                            <UiBaseIcon :path="tab.icon" size="20" />
                            {{ tab.name }}
                        </button>
                    </template>
                </nav>
            </div>

            <!-- Horizontal Tabs for smaller screens -->
            <div class="block md:hidden p-4">
                <nav aria-label="Tabs" class="flex overflow-x-auto">
                    <button v-for="tab in [t('accountSettings.tabs.account'), t('accountSettings.tabs.sync'), 'Activity', t('accountSettings.tabs.developer'), 'Labs']" :key="tab"
                        :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}` }"
                        @click="activeTab = `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}`"
                        class="rounded-lg px-4 py-2 text-left text-nowrap">
                        {{ tab }}
                    </button>
                </nav>
            </div>

            <!-- Tab Content -->
            
            <div class="flex-grow md:pl-6 overflow-y-auto my-2 md:mx-auto">
                <SettingsAccountModule v-if="activeTab === '#horizontal-scroll-tab-cuenta'" />
                <SettingsAnkiModule v-if="activeTab === '#horizontal-scroll-tab-sincronización-anki'" />
                <SettingsDeveloperModule v-if="activeTab === '#horizontal-scroll-tab-desarrollador'" />
                <SettingsActivityModule v-if="activeTab === '#horizontal-scroll-tab-activity'" />
                <SettingsLabsModule v-if="activeTab === '#horizontal-scroll-tab-labs'" />
                <SettingsReportsModule v-if="activeTab === '#horizontal-scroll-tab-reports'" />
            </div>
        </div>
    </div>
    </NuxtLayout>
</template>

<style>
.tab-title-settings:hover {
    background: rgba(255, 255, 255, 0.1);
}

.tab-title-settings.active {
    background: rgba(255, 255, 255, 0.1);
    font-weight: bold;
    font-weight: 600;
}

.tab-title-settings.active:after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 2px;
}
</style>
