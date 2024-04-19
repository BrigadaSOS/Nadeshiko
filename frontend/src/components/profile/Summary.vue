<script setup>
import { ref, watch } from 'vue'
import FileExplorer from './FileExplorer.vue'
import AccountModule from './account/AccountModule.vue'
import AnkiModule from './srs/AnkiModule.vue'
import DeveloperModule from './developer/DeveloperModule.vue'
import { useI18n } from 'vue-i18n'
import { mdiAccount, mdiEmail, mdiSync, mdiCodeTags } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import { useRoute, useRouter } from 'vue-router'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const tabs_general = [
  { name: 'Cuenta', icon: mdiAccount, route: '/settings/account' },
  { name: 'Sincronización', icon: mdiSync, route: '/settings/sync' },
];
const tabs_advanced = [
  { name: 'Desarrollador', icon: mdiCodeTags, route: '/settings/developer' },
];

const activeTab = ref('')
watch(() => route.path, (newPath) => {
  if (newPath.startsWith('/settings/account')) {
    activeTab.value = '#horizontal-scroll-tab-cuenta';
  } else if (newPath.startsWith('/settings/sync')) {
    activeTab.value = '#horizontal-scroll-tab-sincronización';
  } else if (newPath.startsWith('/settings/developer')) {
    activeTab.value = '#horizontal-scroll-tab-desarrollador';
  }
}, { immediate: true })

const navigateToTab = (path) => {
  router.push(path);
}

</script>

<template>

  <div class="w-11/12 mx-auto  my-2 text-white min-h-screen ">
    <div class="flex flex-col md:flex-row">
      <!-- Vertical Tabs -->
      <div
        class="hidden  mx-auto  md:block md:sticky top-0 md:h-screen md:overflow-y-auto md:w-1/4 xl:w-3/12 ">
        <nav aria-label="Tabs" class="flex flex-col bg-sgray2 rounded-lg p-6 my-2 space-y-2">
          <h3 class="text-lg text-white/90 tracking-wide font-semibold">General</h3>
          <div class="border-b  border-white/10" />
          <button v-for="tab in tabs_general" :key="tab.name"
            :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}` }"
            @click="navigateToTab(tab.route)"
            class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
            <BaseIcon :path="tab.icon" size="20" />
            {{ tab.name }}
          </button>

          <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">Avanzado</h3>
          <div class="border-b  border-white/10" />
          <button v-for="tab in tabs_advanced" :key="tab.name"
            :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}` }"
            @click="navigateToTab(tab.route)"
            class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
            <BaseIcon :path="tab.icon" size="20" />
            {{ tab.name }}
          </button>
        </nav>
      </div>

      <!-- Horizontal Tabs for smaller screens -->
      <div class="block md:hidden p-4">
        <nav aria-label="Tabs" class="flex overflow-x-auto">
          <button v-for="tab in ['Cuenta', 'Sincronización', 'Desarrollador']" :key="tab"
            :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}` }"
            @click="activeTab = `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}`"
            class=" rounded-lg px-4 py-2 text-left text-nowrap">
            {{ tab }}
          </button>
        </nav>
      </div>

      <!-- Tab Content -->
      <div class="flex-grow md:pl-6 overflow-y-auto my-2 md:mx-auto">
        <div v-if="activeTab === '#horizontal-scroll-tab-cuenta'">
          <AccountModule />
        </div>
        <div v-if="activeTab === '#horizontal-scroll-tab-sincronización'">
          <AnkiModule />
        </div>
        <div v-if="activeTab === '#horizontal-scroll-tab-desarrollador'">
          <DeveloperModule />
        </div>
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
