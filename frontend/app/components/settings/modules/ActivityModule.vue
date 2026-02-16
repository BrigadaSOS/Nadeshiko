<script setup lang="ts">
import { getRequestHeader } from 'h3';

type ActivityType = 'SEARCH' | 'ANKI_EXPORT' | 'SEGMENT_PLAY' | 'LIST_ADD_SEGMENT';

type ActivityItem = {
  id: number;
  activityType: ActivityType;
  segmentUuid?: string | null;
  mediaId?: number | null;
  searchQuery?: string | null;
  createdAt: string;
};

type ActivityStats = {
  totalSearches: number;
  totalExports: number;
  totalPlays: number;
  totalListAdds: number;
  streakDays?: number;
  topMedia: { mediaId: number; count: number }[];
};

type ActivityResponse = {
  activities: ActivityItem[];
  pagination?: { hasMore: boolean; cursor?: number | null };
  hasMore?: boolean;
  cursor?: number | null;
};

type StatsRange = '7d' | '30d' | '90d' | 'all';

const HEATMAP_DAYS = 365;
const ACTIVITY_PAGE_SIZE = 20;

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const getServerRequestContext = () => {
  if (!import.meta.server) return null;
  const event = useRequestEvent();
  if (!event) return null;

  const config = useRuntimeConfig();
  const cookieHeader = getRequestHeader(event, 'cookie');
  const headers: Record<string, string> = { cookie: cookieHeader || '' };
  if (config.backendHostHeader) {
    headers.host = String(config.backendHostHeader);
  }

  return {
    baseUrl: String(config.backendInternalUrl || ''),
    headers,
  };
};

const fetchAuthed = async <T>(path: string, fallback: T, params?: Record<string, any>): Promise<T> => {
  if (import.meta.server) {
    const ctx = getServerRequestContext();
    if (!ctx || !ctx.baseUrl) return fallback;
    return await $fetch<T>(`${ctx.baseUrl}${path}`, {
      headers: ctx.headers,
      params,
    }).catch(() => fallback);
  }

  return await $fetch<T>(path, {
    credentials: 'include',
    params,
  }).catch(() => fallback);
};

const toDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const extractPagination = (payload: ActivityResponse): { hasMore: boolean; cursor: number | null } => {
  const hasMore = payload.pagination?.hasMore ?? payload.hasMore ?? false;
  const cursor = payload.pagination?.cursor ?? payload.cursor ?? null;
  return { hasMore, cursor };
};

const sinceForRange = (range: StatsRange): string | undefined => {
  if (range === 'all') return undefined;
  const d = new Date();
  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  d.setDate(d.getDate() - (daysMap[range] ?? 7));
  return toDayKey(d);
};

const { data: initialData } = await useAsyncData(
  'settings-activity-initial',
  async () => {
    const since7d = sinceForRange('7d');
    const [statsRaw, activityRaw, prefsRaw, heatmapRaw] = await Promise.all([
      fetchAuthed<ActivityStats | null>('/v1/user/activity/stats', null, since7d ? { since: since7d } : undefined),
      fetchAuthed<ActivityResponse>(
        '/v1/user/activity',
        { activities: [], pagination: { hasMore: false, cursor: null } },
        {
          limit: ACTIVITY_PAGE_SIZE,
        },
      ),
      fetchAuthed<{ searchHistory?: { enabled: boolean } }>('/v1/user/preferences', {}),
      fetchAuthed<{ counts: Record<string, number> }>(
        '/v1/user/activity/heatmap',
        { counts: {} },
        {
          days: HEATMAP_DAYS,
          activityType: 'SEARCH',
        },
      ),
    ]);

    const pagination = extractPagination(activityRaw);

    return {
      stats: statsRaw,
      activities: activityRaw.activities ?? [],
      hasMore: pagination.hasMore,
      cursor: pagination.cursor,
      trackingEnabled: prefsRaw?.searchHistory?.enabled !== false,
      heatmapCounts: heatmapRaw.counts,
    };
  },
  {
    default: () => ({
      stats: null as ActivityStats | null,
      activities: [] as ActivityItem[],
      hasMore: false,
      cursor: null as number | null,
      trackingEnabled: true,
      heatmapCounts: {} as Record<string, number>,
    }),
  },
);

const stats = ref<ActivityStats | null>(initialData.value.stats);
const statsRange = ref<StatsRange>('7d');

const activities = ref<ActivityItem[]>(initialData.value.activities);
const hasMore = ref(initialData.value.hasMore);
const activityCursor = ref<number | null>(initialData.value.cursor);
const loadingMore = ref(false);
const loadingActivities = ref(false);
const trackingEnabled = ref(initialData.value.trackingEnabled);
const togglingTracking = ref(false);
const clearingHistory = ref(false);
const heatmapLoading = ref(false);
const searchCountsByDay = ref<Record<string, number>>(initialData.value.heatmapCounts);
const selectedDay = ref<string | null>(null);

const fetchTrackingState = async () => {
  const prefs = await fetchAuthed<{ searchHistory?: { enabled: boolean } }>('/v1/user/preferences', {});
  trackingEnabled.value = prefs?.searchHistory?.enabled !== false;
};

const fetchStats = async () => {
  const since = sinceForRange(statsRange.value);
  stats.value = await fetchAuthed<ActivityStats | null>('/v1/user/activity/stats', null, since ? { since } : undefined);
};

const fetchActivity = async (append = false) => {
  const params: Record<string, any> = { limit: ACTIVITY_PAGE_SIZE };
  if (append && activityCursor.value) params.cursor = activityCursor.value;
  if (selectedDay.value) params.date = selectedDay.value;

  const result = await fetchAuthed<ActivityResponse>(
    '/v1/user/activity',
    { activities: [], pagination: { hasMore: false, cursor: null } },
    params,
  );
  const pagination = extractPagination(result);

  if (append) {
    activities.value.push(...(result.activities ?? []));
  } else {
    activities.value = result.activities ?? [];
  }
  hasMore.value = pagination.hasMore;
  activityCursor.value = pagination.cursor;
};

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  await fetchActivity(true);
  loadingMore.value = false;
};

const selectDay = async (dayKey: string) => {
  if (selectedDay.value === dayKey) return;
  selectedDay.value = dayKey;
  loadingActivities.value = true;
  activityCursor.value = null;
  await fetchActivity();
  loadingActivities.value = false;
};

const clearDayFilter = async () => {
  selectedDay.value = null;
  loadingActivities.value = true;
  activityCursor.value = null;
  await fetchActivity();
  loadingActivities.value = false;
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
    selectedDay.value = null;
    searchCountsByDay.value = {};
    await fetchStats();
    await loadHeatmap();
  } catch (error) {
    console.error('[Activity] Failed to clear history:', error);
  } finally {
    clearingHistory.value = false;
  }
};

const activityTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    SEARCH: 'Search',
    ANKI_EXPORT: 'Anki Export',
    SEGMENT_PLAY: 'Audio Play',
    LIST_ADD_SEGMENT: 'Collection Add',
  };
  return labels[type] || type;
};

const activityTypeClass = (type: string) => {
  const classes: Record<string, string> = {
    SEARCH: 'border-red-400/40 bg-red-500/10 text-red-300',
    ANKI_EXPORT: 'border-blue-400/40 bg-blue-500/10 text-blue-300',
    SEGMENT_PLAY: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
    LIST_ADD_SEGMENT: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  };
  return classes[type] || 'border-white/20 bg-white/5 text-white/80';
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDayLabel = (dayKey: string) => {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const heatCellClass = (count: number): string => {
  const classes = [
    'bg-white/5 border-white/10',
    'bg-red-900/50 border-red-800/60',
    'bg-red-700/60 border-red-600/70',
    'bg-red-500/70 border-red-400/80',
    'bg-red-300/80 border-red-200/80',
  ] as const;
  const level = count <= 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
  return classes[level] ?? classes[0];
};

// Heatmap: group days by month with gaps between months
type HeatmapDay = {
  key: string;
  count: number;
  label: string;
  dayOfWeek: number;
};

type MonthGroup = {
  label: string;
  days: HeatmapDay[];
};

const heatmapMonthGroups = computed<MonthGroup[]>(() => {
  const end = startOfDay(new Date());
  // Start from (HEATMAP_DAYS-1) days ago, aligned to previous Sunday
  const rawStart = new Date(end);
  rawStart.setDate(rawStart.getDate() - (HEATMAP_DAYS - 1));
  const start = new Date(rawStart);
  start.setDate(start.getDate() - start.getDay());

  const groups: MonthGroup[] = [];
  let currentMonth = -1;
  let currentGroup: MonthGroup | null = null;

  const cursor = new Date(start);
  while (cursor <= end) {
    const m = cursor.getMonth();
    if (m !== currentMonth) {
      currentGroup = { label: MONTH_NAMES[m] ?? '', days: [] };
      groups.push(currentGroup);
      currentMonth = m;
    }

    const key = toDayKey(cursor);
    currentGroup?.days.push({
      key,
      count: searchCountsByDay.value[key] ?? 0,
      label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      dayOfWeek: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return groups;
});

const loadHeatmap = async () => {
  heatmapLoading.value = true;
  const result = await fetchAuthed<{ counts: Record<string, number> }>(
    '/v1/user/activity/heatmap',
    { counts: {} },
    { days: HEATMAP_DAYS, activityType: 'SEARCH' },
  );
  searchCountsByDay.value = result.counts;
  heatmapLoading.value = false;
};

watch(statsRange, () => {
  fetchStats();
});

onMounted(async () => {
  await fetchTrackingState();
});
</script>

<template>
  <!-- Activity Overview -->
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md border border-white/10">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">Activity Overview</h3>
        <p class="text-sm text-gray-400 mt-1">Useful metrics from your search and study behavior.</p>
      </div>
      <div class="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          v-for="range in (['7d', '30d', '90d', 'all'] as const)"
          :key="range"
          :class="[
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            statsRange === range
              ? 'bg-red-500/80 text-white'
              : 'text-gray-400 hover:text-white hover:bg-white/10',
          ]"
          @click="statsRange = range"
        >
          {{ range === 'all' ? 'All Time' : range }}
        </button>
      </div>
    </div>

    <div class="mt-5 grid grid-cols-3 gap-3">
      <div class="rounded-lg border border-white/10 bg-white/5 p-4">
        <p class="text-xs uppercase tracking-wide text-gray-400">Sentences Searched</p>
        <p class="mt-2 text-2xl font-semibold text-white">{{ stats?.totalSearches ?? 0 }}</p>
      </div>
      <div class="rounded-lg border border-white/10 bg-white/5 p-4">
        <p class="text-xs uppercase tracking-wide text-gray-400">Audios Played</p>
        <p class="mt-2 text-2xl font-semibold text-white">{{ stats?.totalPlays ?? 0 }}</p>
      </div>
      <div class="rounded-lg border border-white/10 bg-white/5 p-4">
        <p class="text-xs uppercase tracking-wide text-gray-400">Anki Exports</p>
        <p class="mt-2 text-2xl font-semibold text-white">{{ stats?.totalExports ?? 0 }}</p>
      </div>
    </div>
  </div>

  <!-- Search Heatmap -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Search Heatmap</h3>
    <p class="text-sm text-gray-400 mt-1">Search activity over the last {{ HEATMAP_DAYS }} days. Click a day to filter activity.</p>

    <div v-if="heatmapLoading" class="mt-4 text-gray-400">Loading heatmap...</div>
    <div
      v-else
      class="heatmap mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-3"
    >
      <div class="flex w-full">
        <!-- Day of week labels -->
        <div class="heatmap-day-labels flex flex-col shrink-0 mr-1">
          <div class="heatmap-month-label-spacer" />
          <div
            v-for="(label, i) in DAY_LABELS"
            :key="i"
            class="heatmap-cell flex items-center justify-end pr-1"
          >
            <span class="text-[10px] text-gray-500 leading-none">{{ label }}</span>
          </div>
        </div>

        <!-- Month groups spread to fill width, scrollable when narrower -->
        <div class="heatmap-months flex min-w-max w-full justify-between">
          <div v-for="(group, gi) in heatmapMonthGroups" :key="gi" class="flex flex-col">
            <!-- Month label -->
            <div class="heatmap-month-label text-xs text-gray-400">{{ group.label }}</div>
            <!-- Days grid for this month -->
            <div class="heatmap-grid grid grid-flow-col grid-rows-7">
              <div
                v-for="day in group.days"
                :key="day.key"
                :title="`${day.label}: ${day.count} search${day.count === 1 ? '' : 'es'}`"
                :class="[
                  'heatmap-cell rounded-sm border transition-colors cursor-pointer',
                  heatCellClass(day.count),
                  selectedDay === day.key ? 'ring-2 ring-white/60' : '',
                ]"
                @click="selectDay(day.key)"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <span>Less</span>
        <span class="heatmap-legend-cell rounded-sm border border-white/10 bg-white/5" />
        <span class="heatmap-legend-cell rounded-sm border border-red-800/60 bg-red-900/50" />
        <span class="heatmap-legend-cell rounded-sm border border-red-600/70 bg-red-700/60" />
        <span class="heatmap-legend-cell rounded-sm border border-red-400/80 bg-red-500/70" />
        <span class="heatmap-legend-cell rounded-sm border border-red-200/80 bg-red-300/80" />
        <span>More</span>
      </div>
    </div>
  </div>

  <!-- Activity History -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">Activity History</h3>
        <p class="text-sm text-gray-400 mt-1">Latest events from your account.</p>
      </div>

      <div
        v-if="selectedDay"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-400/40 bg-red-500/10 text-red-300 text-sm"
      >
        <span>Showing: {{ formatDayLabel(selectedDay) }}</span>
        <button
          class="hover:text-white transition-colors ml-1"
          title="Clear day filter"
          @click="clearDayFilter"
        >
          &times;
        </button>
      </div>
    </div>

    <div v-if="loadingActivities" class="mt-4 text-gray-400">Loading...</div>
    <div v-else-if="activities.length === 0" class="mt-4 text-gray-400">No activity recorded{{ selectedDay ? ' for this day' : ' yet' }}.</div>
    <div v-else class="mt-4">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-white/10 text-left">
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium">Type</th>
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium">Query / Details</th>
            <th class="pb-2 text-xs uppercase tracking-wide text-gray-400 font-medium text-right">Date</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr
            v-for="activity in activities"
            :key="activity.id"
            class="group"
          >
            <td class="py-2.5 pr-4 whitespace-nowrap">
              <span
                :class="[
                  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
                  activityTypeClass(activity.activityType),
                ]"
              >
                {{ activityTypeLabel(activity.activityType) }}
              </span>
            </td>
            <td class="py-2.5 pr-4 max-w-md truncate">
              <span v-if="activity.searchQuery" class="text-gray-200">"{{ activity.searchQuery }}"</span>
              <span v-else class="text-gray-500">-</span>
            </td>
            <td class="py-2.5 text-right text-gray-400 text-xs whitespace-nowrap">
              {{ formatDate(activity.createdAt) }}
            </td>
          </tr>
        </tbody>
      </table>

      <button
        v-if="hasMore"
        class="mt-4 w-full rounded-md border border-white/15 bg-white/5 py-2 text-center text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Loading...' : 'Load more' }}
      </button>
    </div>
  </div>

  <!-- Privacy -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Privacy</h3>

    <div class="mt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">Activity Tracking</p>
          <p class="text-gray-400 text-sm">Track searches, exports, and listening history.</p>
        </div>
        <button
          :disabled="togglingTracking"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            trackingEnabled ? 'bg-red-500' : 'bg-gray-600',
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

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-white font-medium">Clear History</p>
          <p class="text-gray-400 text-sm">Permanently delete all activity data from your account.</p>
        </div>
        <button
          class="bg-button-danger-main hover:bg-button-danger-hover text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          :disabled="clearingHistory"
          @click="clearHistory"
        >
          {{ clearingHistory ? 'Clearing...' : 'Clear History' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.heatmap {
  --cell: 10px;
  --gap: 2px;
  --month-gap: 6px;
}

@media (min-width: 640px) {
  .heatmap {
    --cell: 12px;
    --gap: 3px;
    --month-gap: 10px;
  }
}

@media (min-width: 1024px) {
  .heatmap {
    --cell: 14px;
    --gap: 3px;
    --month-gap: 14px;
  }
}

@media (min-width: 1280px) {
  .heatmap {
    --cell: 16px;
    --gap: 4px;
    --month-gap: 18px;
  }
}

.heatmap-cell {
  width: var(--cell);
  height: var(--cell);
}

.heatmap-grid {
  gap: var(--gap);
}

.heatmap-day-labels {
  gap: var(--gap);
}

.heatmap-months {
  gap: var(--month-gap);
}

.heatmap-month-label {
  height: calc(var(--cell) + 4px);
  line-height: calc(var(--cell) + 4px);
  margin-bottom: var(--gap);
}

.heatmap-month-label-spacer {
  height: calc(var(--cell) + 4px + var(--gap));
}

.heatmap-legend-cell {
  width: var(--cell);
  height: var(--cell);
}
</style>
