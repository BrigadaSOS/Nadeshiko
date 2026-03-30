<script setup lang="ts">
const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'media', label: 'Media' },
  { key: 'activity', label: 'Activity' },
  { key: 'collections', label: 'Collections' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'users', label: 'Users' },
  { key: 'system', label: 'System' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

const activeTab = ref<TabKey>('overview');
const dateRange = ref(30);
const isRefreshing = ref(false);

const showDateRange = computed(() => activeTab.value === 'overview' || activeTab.value === 'activity');

const activeTabRef = ref<{ refresh: () => Promise<void> } | null>(null);

const refreshActiveTab = async () => {
  isRefreshing.value = true;
  await activeTabRef.value?.refresh();
  isRefreshing.value = false;
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white">Dashboard</h1>
      <div class="flex items-center gap-3">
        <AdminDashboardDateRangeSelector v-if="showDateRange" v-model="dateRange" />
        <button
          :disabled="isRefreshing"
          class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-50"
          @click="refreshActiveTab"
        >
          {{ isRefreshing ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="flex gap-1 mb-6 overflow-x-auto pb-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 text-sm rounded-lg whitespace-nowrap transition-colors"
        :class="activeTab === tab.key
          ? 'bg-neutral-700 text-white'
          : 'text-gray-400 hover:text-gray-300 hover:bg-neutral-800'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <KeepAlive>
      <AdminDashboardOverviewTab v-if="activeTab === 'overview'" ref="activeTabRef" :days="dateRange" />
      <AdminDashboardMediaTab v-else-if="activeTab === 'media'" ref="activeTabRef" />
      <AdminDashboardActivityTab v-else-if="activeTab === 'activity'" ref="activeTabRef" :days="dateRange" />
      <AdminDashboardCollectionsTab v-else-if="activeTab === 'collections'" ref="activeTabRef" />
      <AdminDashboardApiKeysTab v-else-if="activeTab === 'api-keys'" ref="activeTabRef" />
      <AdminDashboardUsersTab v-else-if="activeTab === 'users'" ref="activeTabRef" />
      <AdminDashboardSystemTab v-else-if="activeTab === 'system'" ref="activeTabRef" />
    </KeepAlive>
  </div>
</template>
