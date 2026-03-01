<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  mdiAccount,
  mdiSync,
  mdiCodeTags,
  mdiFlask,
  mdiEyeOffOutline,
  mdiHistory,
  mdiFormatListBulletedSquare,
  mdiViewDashboardOutline,
  mdiShieldCrownOutline,
} from '@mdi/js';
import { useDragScroll } from '~/composables/useDragScroll';

const SettingsAccountModule = defineAsyncComponent(() => import('../../components/settings/modules/AccountModule.vue'));
const SettingsAnkiModule = defineAsyncComponent(() => import('../../components/settings/modules/AnkiModule.vue'));
const SettingsDeveloperModule = defineAsyncComponent(
  () => import('../../components/settings/modules/DeveloperModule.vue'),
);
const SettingsLabsModule = defineAsyncComponent(() => import('../../components/settings/modules/LabsModule.vue'));
const SettingsActivityModule = defineAsyncComponent(
  () => import('../../components/settings/modules/ActivityModule.vue'),
);
const SettingsCollectionsModule = defineAsyncComponent(
  () => import('../../components/settings/modules/CollectionsModule.vue'),
);
const SettingsHiddenMediaModule = defineAsyncComponent(
  () => import('../../components/settings/modules/HiddenMediaModule.vue'),
);
const SettingsDashboardModule = defineAsyncComponent(
  () => import('../../components/settings/modules/DashboardModule.vue'),
);
const SettingsReportsModule = defineAsyncComponent(() => import('../../components/settings/modules/ReportsModule.vue'));

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const store = userStore();
const isAuth = computed(() => store.isLoggedIn);
const canUseAuthenticatedTabs = computed(() => isAuth.value);

const tabsGeneral = computed(() => [
  { name: 'Settings', icon: mdiAccount, route: '/user/settings', requiresAuth: true },
  { name: t('accountSettings.tabs.sync'), icon: mdiSync, route: '/user/sync', requiresAuth: true },
  { name: 'Collections', icon: mdiFormatListBulletedSquare, route: '/user/collections', requiresAuth: true },
  { name: 'Activity', icon: mdiHistory, route: '/user/activity', requiresAuth: true },
  { name: 'Hide Media', icon: mdiEyeOffOutline, route: '/user/hide-media', requiresAuth: true },
]);

const tabsAdvanced = computed(() => [
  { name: t('accountSettings.tabs.developer'), icon: mdiCodeTags, route: '/user/developer', requiresAuth: true },
  { name: 'Labs', icon: mdiFlask, route: '/user/labs', requiresAuth: true },
]);

const tabsAdmin = computed(() => [
  { name: 'Dashboard', icon: mdiViewDashboardOutline, route: '/user/admin/dashboard', requiresAuth: true },
  { name: 'Reports', icon: mdiShieldCrownOutline, route: '/user/admin/reports', requiresAuth: true },
]);

const allTabs = computed(() => [
  ...tabsGeneral.value,
  ...tabsAdvanced.value,
  ...(store.isAdmin ? tabsAdmin.value : []),
]);

const activeTabRoute = computed(() => {
  const path = route.path;
  if (path.startsWith('/user/admin/dashboard')) return '/user/admin/dashboard';
  if (path.startsWith('/user/admin/reports')) return '/user/admin/reports';
  if (
    path === '/user' ||
    path.startsWith('/user/settings') ||
    path.startsWith('/user/account') ||
    path.startsWith('/user/settigns')
  )
    return '/user/settings';
  if (path.startsWith('/user/sync')) return '/user/sync';
  if (path.startsWith('/user/collections')) return '/user/collections';
  if (path.startsWith('/user/activity')) return '/user/activity';
  if (path.startsWith('/user/hide-media')) return '/user/hide-media';
  if (path.startsWith('/user/developer')) return '/user/developer';
  if (path.startsWith('/user/labs')) return '/user/labs';
  return '';
});

const navigateToTab = (path: string) => {
  router.push(path);
};

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const store = userStore();
    const allowed = [
      '/user/settings',
      '/user/sync',
      '/user/collections',
      '/user/activity',
      '/user/hide-media',
      '/user/developer',
      '/user/labs',
    ];
    const adminAllowed = ['/user/admin/dashboard', '/user/admin/reports'];

    if (store.isLoggedIn) {
      if (to.path === '/user') {
        return navigateTo('/user/settings', { replace: true });
      }

      if (to.path.startsWith('/user/account')) {
        return navigateTo(to.path.replace('/user/account', '/user/settings'), { replace: true });
      }

      if (to.path.startsWith('/user/settigns')) {
        return navigateTo(to.path.replace('/user/settigns', '/user/settings'), { replace: true });
      }

      if (to.path.startsWith('/user/admin')) {
        if (!store.isAdmin) {
          return navigateTo('/user/settings', { replace: true });
        }
        if (to.path === '/user/admin') {
          return navigateTo('/user/admin/dashboard', { replace: true });
        }
        if (!adminAllowed.some((prefix) => to.path.startsWith(prefix))) {
          return navigateTo('/user/admin/dashboard', { replace: true });
        }
        return;
      }

      if (!allowed.some((prefix) => to.path.startsWith(prefix))) {
        return navigateTo('/user/settings', { replace: true });
      }

      return;
    }

    return navigateTo('/', { replace: true });
  }),
});

const mobileTabsRef = ref<HTMLElement | null>(null);
useDragScroll(mobileTabsRef);
</script>

<template>
  <NuxtLayout>
    <div class="w-11/12 mx-auto my-2 text-white min-h-screen">
      <div class="flex flex-col md:flex-row">
        <div class="hidden mx-auto md:block md:w-1/4 xl:w-3/12 md:min-w-[220px]">
          <nav aria-label="Tabs" class="flex flex-col dark:bg-card-background rounded-lg p-6 my-2 space-y-2">
            <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.generalTitle") }}</h3>
            <div class="border-b border-white/10" />
            <button
              v-for="tab in tabsGeneral"
              :key="tab.route"
              :class="{
                active: activeTabRoute === tab.route,
                'opacity-50 cursor-not-allowed': !canUseAuthenticatedTabs && tab.requiresAuth
              }"
              :disabled="!canUseAuthenticatedTabs && tab.requiresAuth"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
              @click="(!tab.requiresAuth || canUseAuthenticatedTabs) ? navigateToTab(tab.route) : null"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </button>

            <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.advancedTitle") }}</h3>
            <div class="border-b border-white/10" />
            <button
              v-for="tab in tabsAdvanced"
              :key="tab.route"
              :class="{
                active: activeTabRoute === tab.route,
                'opacity-50 cursor-not-allowed': !canUseAuthenticatedTabs && tab.requiresAuth
              }"
              :disabled="!canUseAuthenticatedTabs && tab.requiresAuth"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
              @click="(!tab.requiresAuth || canUseAuthenticatedTabs) ? navigateToTab(tab.route) : null"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </button>

            <template v-if="store.isAdmin">
              <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">Admin</h3>
              <div class="border-b border-white/10" />
              <button
                v-for="tab in tabsAdmin"
                :key="tab.route"
                :class="{ active: activeTabRoute === tab.route }"
                class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
                @click="navigateToTab(tab.route)"
              >
                <UiBaseIcon :path="tab.icon" size="20" />
                {{ tab.name }}
              </button>
            </template>
          </nav>
        </div>

        <div class="block md:hidden">
          <nav ref="mobileTabsRef" aria-label="Tabs" class="mobile-settings-tabs flex select-none overflow-x-auto">
            <button
              v-for="tab in allTabs"
              :key="tab.route"
              :class="[
                'mobile-settings-tab relative px-4 py-3 text-sm text-nowrap shrink-0 transition-colors border-b-2',
                activeTabRoute === tab.route
                  ? 'text-red-400 font-semibold border-red-500'
                  : 'text-gray-400 hover:text-white border-white/10',
                !canUseAuthenticatedTabs && tab.requiresAuth ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              ]"
              :disabled="!canUseAuthenticatedTabs && tab.requiresAuth"
              @click="(!tab.requiresAuth || canUseAuthenticatedTabs) ? navigateToTab(tab.route) : null"
            >
              {{ tab.name }}
            </button>
          </nav>
        </div>

        <div class="flex-grow md:pl-6 overflow-y-auto my-2 md:mx-auto min-w-0">
          <SettingsAccountModule v-if="activeTabRoute === '/user/settings'" />
          <SettingsAnkiModule v-if="activeTabRoute === '/user/sync'" />
          <SettingsCollectionsModule v-if="activeTabRoute === '/user/collections'" />
          <SettingsActivityModule v-if="activeTabRoute === '/user/activity'" />
          <SettingsHiddenMediaModule v-if="activeTabRoute === '/user/hide-media'" />
          <SettingsDeveloperModule v-if="activeTabRoute === '/user/developer'" />
          <SettingsLabsModule v-if="activeTabRoute === '/user/labs'" />
          <SettingsDashboardModule v-if="activeTabRoute === '/user/admin/dashboard'" />
          <SettingsReportsModule v-if="activeTabRoute === '/user/admin/reports'" />
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
  font-weight: 600;
}

.mobile-settings-tabs {
  scrollbar-width: none; /* Firefox */
  -webkit-overflow-scrolling: touch;
}

.mobile-settings-tabs::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}
</style>
