<script setup lang="ts">
const isLoading = ref(true);
const stats = ref<{
  totalSearches: number;
  totalExports: number;
  totalPlays: number;
  totalListAdds: number;
  streakDays: number;
  topMedia: { mediaId: number; count: number }[];
} | null>(null);

const activities = ref<any[]>([]);
const hasMore = ref(false);
const activityCursor = ref<number | null>(null);
const loadingMore = ref(false);
const trackingEnabled = ref(true);
const togglingTracking = ref(false);
const clearingHistory = ref(false);
const exportingData = ref(false);

onMounted(async () => {
  await Promise.all([fetchStats(), fetchActivity(), fetchTrackingState()]);
  isLoading.value = false;
});

const fetchTrackingState = async () => {
  try {
    const prefs = await $fetch<{ searchHistory?: { enabled: boolean } }>('/v1/user/preferences', {
      credentials: 'include',
    });
    trackingEnabled.value = prefs?.searchHistory?.enabled !== false;
  } catch {
    /* default: enabled */
  }
};

const fetchStats = async () => {
  try {
    stats.value = await $fetch('/v1/user/activity/stats', { credentials: 'include' });
  } catch (error) {
    console.error('[Activity] Failed to fetch stats:', error);
  }
};

const fetchActivity = async () => {
  try {
    const params: Record<string, any> = { size: 20 };
    if (activityCursor.value) params.cursor = activityCursor.value;

    const result = await $fetch<{ data: any[]; hasMore: boolean; cursor?: number | null }>('/v1/user/activity', {
      credentials: 'include',
      params,
    });

    if (activityCursor.value) {
      activities.value.push(...result.data);
    } else {
      activities.value = result.data;
    }
    hasMore.value = result.hasMore;
    activityCursor.value = result.cursor ?? null;
  } catch (error) {
    console.error('[Activity] Failed to fetch activity:', error);
  }
};

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  await fetchActivity();
  loadingMore.value = false;
};

const toggleTracking = async () => {
  if (togglingTracking.value) return;
  togglingTracking.value = true;
  const newValue = !trackingEnabled.value;
  try {
    await $fetch('/v1/user/preferences', {
      method: 'PATCH',
      credentials: 'include',
      body: { searchHistory: { enabled: newValue } },
    });
    trackingEnabled.value = newValue;
  } catch (error) {
    console.error('[Activity] Failed to toggle tracking:', error);
  } finally {
    togglingTracking.value = false;
  }
};

const clearHistory = async () => {
  if (clearingHistory.value) return;
  if (!confirm('Are you sure you want to clear all activity history? This cannot be undone.')) return;
  clearingHistory.value = true;
  try {
    await $fetch('/v1/user/activity', {
      method: 'DELETE',
      credentials: 'include',
    });
    activities.value = [];
    hasMore.value = false;
    activityCursor.value = null;
    await fetchStats();
  } catch (error) {
    console.error('[Activity] Failed to clear history:', error);
  } finally {
    clearingHistory.value = false;
  }
};

const exportData = async () => {
  if (exportingData.value) return;
  exportingData.value = true;
  try {
    const data = await $fetch('/v1/user/export', { credentials: 'include' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nadeshiko-data-export.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[Activity] Failed to export data:', error);
  } finally {
    exportingData.value = false;
  }
};

const activityTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    SEARCH: 'Search',
    ANKI_EXPORT: 'Anki Export',
    SEGMENT_PLAY: 'Segment Play',
    LIST_ADD_SEGMENT: 'Added to List',
  };
  return labels[type] || type;
};

const activityTypeIcon = (type: string) => {
  const icons: Record<string, string> = {
    SEARCH: '🔍',
    ANKI_EXPORT: '📤',
    SEGMENT_PLAY: '▶️',
    LIST_ADD_SEGMENT: '📋',
  };
  return icons[type] || '•';
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};
</script>

<template>
  <!-- Stats Cards -->
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Study Activity</h3>
    <div class="border-b pt-4 border-white/10" />

    <div v-if="isLoading" class="mt-4 text-gray-400">Loading activity data...</div>

    <div v-else-if="stats" class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white/5 rounded-lg p-4 text-center">
        <p class="text-2xl font-bold text-white">{{ stats.totalSearches }}</p>
        <p class="text-gray-400 text-sm">Searches</p>
      </div>
      <div class="bg-white/5 rounded-lg p-4 text-center">
        <p class="text-2xl font-bold text-white">{{ stats.totalExports }}</p>
        <p class="text-gray-400 text-sm">Anki Exports</p>
      </div>
      <div class="bg-white/5 rounded-lg p-4 text-center">
        <p class="text-2xl font-bold text-white">{{ stats.totalPlays }}</p>
        <p class="text-gray-400 text-sm">Segments Played</p>
      </div>
      <div class="bg-white/5 rounded-lg p-4 text-center">
        <p class="text-2xl font-bold text-white">{{ stats.streakDays }}</p>
        <p class="text-gray-400 text-sm">Day Streak</p>
      </div>
    </div>
  </div>

  <!-- Recent Activity Timeline -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Recent Activity</h3>
    <div class="border-b pt-4 border-white/10" />

    <div v-if="activities.length === 0 && !isLoading" class="mt-4 text-gray-400">
      No activity recorded yet.
    </div>

    <div v-else class="mt-4 space-y-3">
      <div
        v-for="activity in activities"
        :key="activity.id"
        class="flex items-start gap-3 p-3 rounded-lg bg-white/5"
      >
        <span class="text-lg">{{ activityTypeIcon(activity.activityType) }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-white text-sm font-medium">{{ activityTypeLabel(activity.activityType) }}</span>
          </div>
          <p v-if="activity.searchQuery" class="text-gray-300 text-sm truncate">
            "{{ activity.searchQuery }}"
          </p>
          <p class="text-gray-500 text-xs mt-1">{{ formatDate(activity.createdAt) }}</p>
        </div>
      </div>
    </div>

    <button
      v-if="hasMore"
      class="mt-4 w-full py-2 text-center text-gray-400 hover:text-white transition-colors"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? 'Loading...' : 'Load more' }}
    </button>
  </div>

  <!-- Privacy Controls -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Privacy</h3>
    <div class="border-b pt-4 border-white/10" />

    <div class="mt-4 space-y-4">
      <!-- Tracking Toggle -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-white">Activity Tracking</p>
          <p class="text-gray-400 text-sm">Track your searches, exports, and listening history.</p>
        </div>
        <button
          :disabled="togglingTracking"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            trackingEnabled ? 'bg-purple-600' : 'bg-gray-600',
          ]"
          @click="toggleTracking"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              trackingEnabled ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>

      <!-- Clear History -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-white">Clear History</p>
          <p class="text-gray-400 text-sm">Permanently delete all your activity data.</p>
        </div>
        <button
          class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="clearingHistory"
          @click="clearHistory"
        >
          {{ clearingHistory ? 'Clearing...' : 'Clear History' }}
        </button>
      </div>

      <!-- Export Data -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-white">Export Data</p>
          <p class="text-gray-400 text-sm">Download all your data as a JSON file.</p>
        </div>
        <button
          class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="exportingData"
          @click="exportData"
        >
          {{ exportingData ? 'Exporting...' : 'Export Data' }}
        </button>
      </div>
    </div>
  </div>
</template>
