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
  mdiAccountGroupOutline,
  mdiShieldCrownOutline,
  mdiBullhornOutline,
} from '@mdi/js';
import { useDragScroll } from '~/composables/useDragScroll';
import { useLocalePreference } from '~/composables/useLocalePreference';
import { splitLocalePrefix } from '~/utils/routes';

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
const SettingsUsersModule = defineAsyncComponent(() => import('../../components/settings/modules/DashboardModule.vue'));
const SettingsReportsModule = defineAsyncComponent(() => import('../../components/settings/modules/ReportsModule.vue'));
const SettingsAnnouncementModule = defineAsyncComponent(
  () => import('../../components/settings/modules/AnnouncementModule.vue'),
);

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const router = useRouter();

const store = userStore();

const tabsGeneral = computed(() => [
  { name: t('accountSettings.tabs.settings'), icon: mdiAccount, route: '/user/settings' },
  { name: t('accountSettings.tabs.sync'), icon: mdiSync, route: '/user/sync' },
  { name: t('accountSettings.tabs.collections'), icon: mdiFormatListBulletedSquare, route: '/user/collections' },
  { name: t('accountSettings.tabs.activity'), icon: mdiHistory, route: '/user/activity' },
  { name: t('accountSettings.tabs.hideMedia'), icon: mdiEyeOffOutline, route: '/user/hide-media' },
]);

const tabsAdvanced = computed(() => [
  { name: t('accountSettings.tabs.developer'), icon: mdiCodeTags, route: '/user/developer' },
  { name: t('accountSettings.tabs.labs'), icon: mdiFlask, route: '/user/labs' },
]);

const tabsAdmin = computed(() => [
  { name: t('accountSettings.tabs.users'), icon: mdiAccountGroupOutline, route: '/user/admin/users' },
  { name: t('accountSettings.tabs.reports'), icon: mdiShieldCrownOutline, route: '/user/admin/reports' },
  { name: t('accountSettings.tabs.announcement'), icon: mdiBullhornOutline, route: '/user/admin/announcement' },
]);

const allTabs = computed(() => [
  ...tabsGeneral.value,
  ...tabsAdvanced.value,
  ...(store.isAdmin ? tabsAdmin.value : []),
]);

const activeTabRoute = computed(() => {
  const path = route.path;
  if (path.startsWith(localePath('/user/admin/users'))) return '/user/admin/users';
  if (path.startsWith(localePath('/user/admin/reports'))) return '/user/admin/reports';
  if (path.startsWith(localePath('/user/admin/announcement'))) return '/user/admin/announcement';
  if (path === localePath('/user') || path.startsWith(localePath('/user/settings'))) return '/user/settings';
  if (path.startsWith(localePath('/user/sync'))) return '/user/sync';
  if (path.startsWith(localePath('/user/collections'))) return '/user/collections';
  if (path.startsWith(localePath('/user/activity'))) return '/user/activity';
  if (path.startsWith(localePath('/user/hide-media'))) return '/user/hide-media';
  if (path.startsWith(localePath('/user/developer'))) return '/user/developer';
  if (path.startsWith(localePath('/user/labs'))) return '/user/labs';
  return '';
});

const navigateToTab = (tabRoute: string) => {
  router.push(localePath(tabRoute));
};

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const store = userStore();
    const localePath = useLocalePath();
    const { preferredLocale } = useLocalePreference();
    const allowed = [
      '/user/settings',
      '/user/sync',
      '/user/collections',
      '/user/activity',
      '/user/hide-media',
      '/user/developer',
      '/user/labs',
    ];
    const adminAllowed = ['/user/admin/users', '/user/admin/reports', '/user/admin/announcement'];

    if (store.isLoggedIn) {
      if (preferredLocale.value) {
        const { localizedPath } = splitLocalePrefix(to.path);
        const preferredPath = localePath(localizedPath, preferredLocale.value);
        if (preferredPath && preferredPath !== to.path) {
          return navigateTo({ path: preferredPath, query: to.query, hash: to.hash }, { replace: true });
        }
      }

      if (to.path === localePath('/user')) {
        return navigateTo(localePath('/user/settings'), { replace: true });
      }

      if (to.path.startsWith(localePath('/user/admin'))) {
        if (!store.isAdmin) {
          return navigateTo(localePath('/user/settings'), { replace: true });
        }
        if (to.path === localePath('/user/admin')) {
          return navigateTo(localePath('/user/admin/users'), { replace: true });
        }
        if (!adminAllowed.some((prefix) => to.path.startsWith(localePath(prefix)))) {
          return navigateTo(localePath('/user/admin/users'), { replace: true });
        }
        return;
      }

      if (!allowed.some((prefix) => to.path.startsWith(localePath(prefix)))) {
        return navigateTo(localePath('/user/settings'), { replace: true });
      }

      return;
    }

    return navigateTo(localePath('/'), { replace: true });
  }),
});

const mobileTabsRef = ref<HTMLElement | null>(null);
useDragScroll(mobileTabsRef);

function scrollActiveTabIntoView() {
  nextTick(() => {
    const container = mobileTabsRef.value;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLElement>('.border-red-500');
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  });
}

onMounted(scrollActiveTabIntoView);
watch(activeTabRoute, scrollActiveTabIntoView);
</script>

<template>
  <div class="w-11/12 mx-auto my-2 text-white min-h-screen">
      <div class="flex flex-col md:flex-row">
        <div class="hidden mx-auto md:block md:w-1/4 xl:w-3/12 md:min-w-[220px]">
          <nav aria-label="Tabs" class="flex flex-col dark:bg-card-background rounded-lg p-6 my-2 space-y-2">
            <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.generalTitle") }}</h3>
            <div class="border-b border-white/10" />
            <button
              v-for="tab in tabsGeneral"
              :key="tab.route"
              :class="{ active: activeTabRoute === tab.route }"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
              @click="navigateToTab(tab.route)"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </button>

            <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.advancedTitle") }}</h3>
            <div class="border-b border-white/10" />
            <button
              v-for="tab in tabsAdvanced"
              :key="tab.route"
              :class="{ active: activeTabRoute === tab.route }"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
              @click="navigateToTab(tab.route)"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </button>

            <template v-if="store.isAdmin">
              <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.adminTitle") }}</h3>
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
                'mobile-settings-tab relative px-4 py-3 text-sm text-nowrap shrink-0 transition-colors border-b-2 cursor-pointer',
                activeTabRoute === tab.route
                  ? 'text-red-400 font-semibold border-red-500'
                  : 'text-gray-400 hover:text-white border-white/10',
              ]"
              @click="navigateToTab(tab.route)"
            >
              {{ tab.name }}
            </button>
          </nav>
        </div>

        <div class="flex-grow md:pl-6 my-2 md:mx-auto min-w-0">
          <SettingsAccountModule v-if="activeTabRoute === '/user/settings'" />
          <SettingsAnkiModule v-if="activeTabRoute === '/user/sync'" />
          <SettingsCollectionsModule v-if="activeTabRoute === '/user/collections'" />
          <SettingsActivityModule v-if="activeTabRoute === '/user/activity'" />
          <SettingsHiddenMediaModule v-if="activeTabRoute === '/user/hide-media'" />
          <SettingsDeveloperModule v-if="activeTabRoute === '/user/developer'" />
          <SettingsLabsModule v-if="activeTabRoute === '/user/labs'" />
          <SettingsUsersModule v-if="activeTabRoute === '/user/admin/users'" />
          <SettingsReportsModule v-if="activeTabRoute === '/user/admin/reports'" />
          <SettingsAnnouncementModule v-if="activeTabRoute === '/user/admin/announcement'" />
        </div>
      </div>
    </div>
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
