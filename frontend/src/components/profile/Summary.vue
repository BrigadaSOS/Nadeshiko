<script setup>
import { ref } from 'vue'
import FileExplorer from './FileExplorer.vue'
import AccountModule from './account/AccountModule.vue'
import AnkiModule from './srs/AnkiModule.vue'
import DeveloperModule from './developer/DeveloperModule.vue'
import { useI18n } from 'vue-i18n'
import { mdiAccount, mdiEmail, mdiSync, mdiCodeTags } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'

const { t, locale } = useI18n()

const tabs_general = [
  { name: 'Cuenta', icon: mdiAccount },
  { name: 'Sincronización', icon: mdiSync },
];
const tabs_advanced = [
  { name: 'Desarrollador', icon: mdiCodeTags },
];

const activeTab = ref('#horizontal-scroll-tab-cuenta') 
</script>

<template>

  <div class="w-11/12 mx-auto bg-[#181a1b] my-2 text-white min-h-screen px-4 md:px-8">
    <div class="flex flex-col md:flex-row">
      <!-- Vertical Tabs -->
      <div
        class="hidden  mx-auto  shadow-md md:block md:sticky top-0 md:h-screen md:overflow-y-auto md:w-1/4 xl:w-3/12 ">
        <nav aria-label="Tabs" class="flex flex-col bg-sgray2  rounded-lg p-6 my-10 space-y-2">
          <h3 class="text-lg text-white/90 tracking-wide font-semibold">General</h3>
          <div class="border-b  border-white/10" />
          <button v-for="tab in tabs_general" :key="tab.name"
            :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}` }"
            @click="activeTab = `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`"
            class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
            <BaseIcon :path="tab.icon" size="20" />
            {{ tab.name }}
          </button>

          <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">Avanzado</h3>
          <div class="border-b  border-white/10" />
          <button v-for="tab in tabs_advanced" :key="tab.name"
            :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}` }"
            @click="activeTab = `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`"
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
      <div class="flex-grow p-4 overflow-y-auto  md:mx-auto">
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
