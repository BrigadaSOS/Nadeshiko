<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  mdiAccount,
  mdiSync,
  mdiCodeTags,
  mdiEyeOffOutline,
  mdiHistory,
  mdiFormatListBulletedSquare,
  mdiAccountGroupOutline,
  mdiShieldCrownOutline,
  mdiBullhornOutline,
} from '@mdi/js';
import { useDragScroll } from '~/composables/useDragScroll';
import { splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();

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

// Locale-agnostic: the child route decides which tab is active, so the nav only
// has to strip the /en|/es|/ja prefix instead of rebuilding every candidate path.
const activeTabRoute = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  const normalized = localizedPath.replace(/\/+$/, '') || '/';
  return normalized === '/user' ? '/user/settings' : normalized;
});

definePageMeta({
  robots: false,
  // Applies to every /user/** child route: Nuxt collects middleware from all
  // matched records, parent first. Per-route redirects (/user, /user/admin and
  // unknown paths) live in the pages that own those URLs.
  middleware: [
    defineNuxtRouteMiddleware(() => {
      const store = userStore();
      if (!store.isLoggedIn) {
        return navigateTo(useLocalePath()('/'), { replace: true });
      }
    }),
    'locale-preference',
    defineNuxtRouteMiddleware((to) => {
      const store = userStore();
      const { localizedPath } = splitLocalePrefix(to.path);
      if (localizedPath.startsWith('/user/admin') && !store.isAdmin) {
        return navigateTo(useLocalePath()('/user/settings'), { replace: true });
      }
    }),
  ],
});

const mobileTabsRef = ref<HTMLElement | null>(null);
useDragScroll(mobileTabsRef);

function scrollActiveTabIntoView() {
  nextTick(() => {
    const container = mobileTabsRef.value;
    if (!container) return;
    // Keyed off the marker attribute rather than the active tab's styling, so
    // restyling the tab can't quietly stop it from scrolling into view.
    const activeBtn = container.querySelector<HTMLElement>('[data-active-tab]');
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
          <nav :aria-label="$t('accountSettings.menu.tabsAriaLabel')" class="flex flex-col dark:bg-card-background rounded-lg p-6 my-2 space-y-2">
            <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.generalTitle") }}</h3>
            <div class="border-b border-white/10" />
            <NuxtLink
              v-for="tab in tabsGeneral"
              :key="tab.route"
              :to="localePath(tab.route)"
              :class="{ active: activeTabRoute === tab.route }"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </NuxtLink>

            <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.advancedTitle") }}</h3>
            <div class="border-b border-white/10" />
            <NuxtLink
              v-for="tab in tabsAdvanced"
              :key="tab.route"
              :to="localePath(tab.route)"
              :class="{ active: activeTabRoute === tab.route }"
              class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
            >
              <UiBaseIcon :path="tab.icon" size="20" />
              {{ tab.name }}
            </NuxtLink>

            <template v-if="store.isAdmin">
              <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.adminTitle") }}</h3>
              <div class="border-b border-white/10" />
              <NuxtLink
                v-for="tab in tabsAdmin"
                :key="tab.route"
                :to="localePath(tab.route)"
                :class="{ active: activeTabRoute === tab.route }"
                class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left"
              >
                <UiBaseIcon :path="tab.icon" size="20" />
                {{ tab.name }}
              </NuxtLink>
            </template>
          </nav>
        </div>

        <div class="block md:hidden">
          <nav ref="mobileTabsRef" :aria-label="$t('accountSettings.menu.tabsAriaLabel')" class="mobile-settings-tabs flex select-none overflow-x-auto">
            <NuxtLink
              v-for="tab in allTabs"
              :key="tab.route"
              :to="localePath(tab.route)"
              :data-active-tab="activeTabRoute === tab.route ? '' : undefined"
              :class="[
                'mobile-settings-tab relative px-4 py-3 text-sm text-nowrap shrink-0 transition-colors border-b-2 cursor-pointer',
                activeTabRoute === tab.route
                  ? 'text-red-400 font-semibold border-red-500'
                  : 'text-gray-400 hover:text-white border-white/10',
              ]"
            >
              {{ tab.name }}
            </NuxtLink>
          </nav>
        </div>

        <div class="flex-grow md:pl-6 my-2 md:mx-auto min-w-0">
          <NuxtPage />
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
