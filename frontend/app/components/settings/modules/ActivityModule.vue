<script setup lang="ts">
const stripTags = (text: string) => {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
};

type ActivityItem = {
  id: number;
  activityType: string;
  segmentId?: string | null;
  mediaId?: number | null;
  searchQuery?: string | null;
  mediaName?: string | null;
  japaneseText?: string | null;
  createdAt: string;
};

type ActivityStats = {
  totalSearches: number;
  totalExports: number;
  totalPlays: number;
  totalShares: number;
  streakDays?: number;
  topMedia: { mediaId: number; count: number }[];
};

type StatsRange = '7d' | '30d' | '90d' | 'all';

type HeatmapRawData = Record<string, Record<string, number>>;

const HEATMAP_DAYS = 365;
const ACTIVITY_PAGE_SIZE = 20;

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const ACTIVITY_TYPES = ['SEARCH', 'SEGMENT_PLAY', 'ANKI_EXPORT', 'SHARE'] as const;

const sdk = useNadeshikoSdk();

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
    const [statsRes, activityRes, prefsRes, heatmapRes] = await Promise.all([
      sdk.getUserActivityStats({ query: since7d ? { since: since7d } : undefined }).catch(() => ({ data: null })),
      sdk.listUserActivity({ query: { take: ACTIVITY_PAGE_SIZE } }).catch(() => ({ data: null })),
      sdk.getUserPreferences().catch(() => ({ data: null })),
      sdk.getUserActivityHeatmap({ query: { days: HEATMAP_DAYS } }).catch(() => ({ data: null })),
    ]);

    const activityData = activityRes.data;
    const prefsData = prefsRes.data as Record<string, any> | null;

    return {
      stats: (statsRes.data ?? null) as ActivityStats | null,
      activities: (activityData?.activities ?? []) as ActivityItem[],
      hasMore: activityData?.pagination?.hasMore ?? false,
      cursor: activityData?.pagination?.cursor ?? null,
      trackingEnabled: prefsData?.searchHistory?.enabled !== false,
      heatmapRaw: (heatmapRes.data?.activityByDay ?? {}) as HeatmapRawData,
    };
  },
  {
    default: () => ({
      stats: null as ActivityStats | null,
      activities: [] as ActivityItem[],
      hasMore: false,
      cursor: null as string | null,
      trackingEnabled: true,
      heatmapRaw: {} as HeatmapRawData,
    }),
  },
);

const stats = ref<ActivityStats | null>(initialData.value.stats);
const statsRange = ref<StatsRange>('7d');

const activities = ref<ActivityItem[]>(initialData.value.activities);
const hasMore = ref(initialData.value.hasMore);
const activityCursor = ref<string | null>(initialData.value.cursor);
const loadingMore = ref(false);
const loadingActivities = ref(false);
const trackingEnabled = ref(initialData.value.trackingEnabled);
const togglingTracking = ref(false);
const clearingHistory = ref(false);
const heatmapLoading = ref(false);
const heatmapFilter = ref<string | null>(null);
const heatmapRaw = ref<HeatmapRawData>(initialData.value.heatmapRaw);
const selectedDay = ref<string | null>(null);
const activityTypeFilter = ref<string | null>(null);

const heatmapCountsByDay = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const [day, types] of Object.entries(heatmapRaw.value)) {
    if (heatmapFilter.value) {
      result[day] = types[heatmapFilter.value] ?? 0;
    } else {
      let total = 0;
      for (const count of Object.values(types)) total += count;
      result[day] = total;
    }
  }
  return result;
});

const fetchTrackingState = async () => {
  const { data } = await sdk.getUserPreferences().catch(() => ({ data: null }));
  const prefs = data as Record<string, any> | null;
  trackingEnabled.value = prefs?.searchHistory?.enabled !== false;
};

const fetchStats = async () => {
  const since = sinceForRange(statsRange.value);
  const { data } = await sdk
    .getUserActivityStats({ query: since ? { since } : undefined })
    .catch(() => ({ data: null }));
  stats.value = (data ?? null) as ActivityStats | null;
};

const fetchActivity = async (append = false) => {
  const query: Record<string, any> = { take: ACTIVITY_PAGE_SIZE };
  if (append && activityCursor.value) query.cursor = activityCursor.value;
  if (selectedDay.value) query.date = selectedDay.value;
  if (activityTypeFilter.value) query.activityType = activityTypeFilter.value;

  const { data } = await sdk.listUserActivity({ query }).catch(() => ({ data: null }));

  if (append) {
    activities.value.push(...((data?.activities ?? []) as ActivityItem[]));
  } else {
    activities.value = (data?.activities ?? []) as ActivityItem[];
  }
  hasMore.value = data?.pagination?.hasMore ?? false;
  activityCursor.value = data?.pagination?.cursor ?? null;
};

const refetchActivity = async () => {
  loadingActivities.value = true;
  activityCursor.value = null;
  await fetchActivity();
  loadingActivities.value = false;
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
  await refetchActivity();
};

const clearDayFilter = async () => {
  selectedDay.value = null;
  await refetchActivity();
};

const toggleTracking = async () => {
  if (togglingTracking.value) return;
  togglingTracking.value = true;
  const newValue = !trackingEnabled.value;
  try {
    await sdk.updateUserPreferences({ body: { searchHistory: { enabled: newValue } } });
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
    await sdk.deleteUserActivity();
    activities.value = [];
    hasMore.value = false;
    activityCursor.value = null;
    selectedDay.value = null;
    heatmapRaw.value = {};
    await fetchStats();
    await loadHeatmap();
  } catch (error) {
    console.error('[Activity] Failed to clear history:', error);
  } finally {
    clearingHistory.value = false;
  }
};

const deletingIds = ref<Set<number>>(new Set());

const deleteActivity = async (id: number) => {
  if (deletingIds.value.has(id)) return;
  deletingIds.value.add(id);
  try {
    await sdk.deleteUserActivityById({ path: { id } });
    activities.value = activities.value.filter((a) => a.id !== id);
  } catch (error) {
    console.error('[Activity] Failed to delete activity:', error);
  } finally {
    deletingIds.value.delete(id);
  }
};

const clearingDay = ref(false);

const clearDayActivity = async () => {
  if (!selectedDay.value || clearingDay.value) return;
  if (!confirm(`Delete all activity for ${formatDayLabel(selectedDay.value)}? This cannot be undone.`)) return;

  clearingDay.value = true;
  try {
    await sdk.deleteUserActivityByDate({ path: { date: selectedDay.value } });
    activities.value = [];
    hasMore.value = false;
    activityCursor.value = null;
    const updated = { ...heatmapRaw.value };
    delete updated[selectedDay.value];
    heatmapRaw.value = updated;
    await fetchStats();
  } catch (error) {
    console.error('[Activity] Failed to clear day activity:', error);
  } finally {
    clearingDay.value = false;
  }
};

const activityTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    SEARCH: 'Search',
    SEGMENT_PLAY: 'Audio Play',
    ANKI_EXPORT: 'Anki Export',
    SHARE: 'Share',
  };
  return labels[type] || type;
};

const activityTypeClass = (type: string) => {
  const classes: Record<string, string> = {
    SEARCH: 'border-red-400/40 bg-red-500/10 text-red-300',
    SEGMENT_PLAY: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
    ANKI_EXPORT: 'border-blue-400/40 bg-blue-500/10 text-blue-300',
    SHARE: 'border-purple-400/40 bg-purple-500/10 text-purple-300',
  };
  return classes[type] || 'border-white/20 bg-white/5 text-white/80';
};

const activityTypeMutedClass = (type: string) => {
  const classes: Record<string, string> = {
    SEARCH: 'border-red-400/20 bg-red-500/5 text-red-300/60 hover:text-red-200 hover:bg-red-500/10',
    SEGMENT_PLAY:
      'border-emerald-400/20 bg-emerald-500/5 text-emerald-300/60 hover:text-emerald-200 hover:bg-emerald-500/10',
    ANKI_EXPORT: 'border-blue-400/20 bg-blue-500/5 text-blue-300/60 hover:text-blue-200 hover:bg-blue-500/10',
    SHARE: 'border-purple-400/20 bg-purple-500/5 text-purple-300/60 hover:text-purple-200 hover:bg-purple-500/10',
  };
  return classes[type] || 'border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10';
};

const heatmapTooltipUnit = (count: number): string => {
  if (!heatmapFilter.value) return `${count} record${count === 1 ? '' : 's'}`;
  const units: Record<string, [string, string]> = {
    SEARCH: ['search', 'searches'],
    SEGMENT_PLAY: ['play', 'plays'],
    ANKI_EXPORT: ['export', 'exports'],
    SHARE: ['share', 'shares'],
  };
  const [singular, plural] = units[heatmapFilter.value] ?? ['action', 'actions'];
  return `${count} ${count === 1 ? singular : plural}`;
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

type GroupedActivity = ActivityItem & { count: number; ids: number[] };

const groupedActivities = computed<GroupedActivity[]>(() => {
  const groups: GroupedActivity[] = [];
  for (const item of activities.value) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.activityType === item.activityType &&
      prev.segmentId === item.segmentId &&
      prev.searchQuery === item.searchQuery
    ) {
      prev.count++;
      prev.ids.push(item.id);
    } else {
      groups.push({ ...item, count: 1, ids: [item.id] });
    }
  }
  return groups;
});

const HEATMAP_PALETTES: Record<string, readonly string[]> = {
  default: [
    'bg-white/5 border-white/10',
    'bg-amber-900/50 border-amber-800/60',
    'bg-amber-700/60 border-amber-600/70',
    'bg-amber-500/70 border-amber-400/80',
    'bg-amber-300/80 border-amber-200/80',
  ],
  SEARCH: [
    'bg-white/5 border-white/10',
    'bg-red-900/50 border-red-800/60',
    'bg-red-700/60 border-red-600/70',
    'bg-red-500/70 border-red-400/80',
    'bg-red-300/80 border-red-200/80',
  ],
  SEGMENT_PLAY: [
    'bg-white/5 border-white/10',
    'bg-emerald-900/50 border-emerald-800/60',
    'bg-emerald-700/60 border-emerald-600/70',
    'bg-emerald-500/70 border-emerald-400/80',
    'bg-emerald-300/80 border-emerald-200/80',
  ],
  ANKI_EXPORT: [
    'bg-white/5 border-white/10',
    'bg-blue-900/50 border-blue-800/60',
    'bg-blue-700/60 border-blue-600/70',
    'bg-blue-500/70 border-blue-400/80',
    'bg-blue-300/80 border-blue-200/80',
  ],
  SHARE: [
    'bg-white/5 border-white/10',
    'bg-purple-900/50 border-purple-800/60',
    'bg-purple-700/60 border-purple-600/70',
    'bg-purple-500/70 border-purple-400/80',
    'bg-purple-300/80 border-purple-200/80',
  ],
};

const activePalette = computed(() => HEATMAP_PALETTES[heatmapFilter.value ?? 'default'] ?? HEATMAP_PALETTES.default);

const heatCellClass = (count: number): string => {
  const palette = activePalette.value;
  const level = count <= 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
  return palette[level] ?? palette[0] ?? '';
};

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
      count: heatmapCountsByDay.value[key] ?? 0,
      label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      dayOfWeek: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return groups;
});

const loadHeatmap = async () => {
  heatmapLoading.value = true;
  const { data } = await sdk.getUserActivityHeatmap({ query: { days: HEATMAP_DAYS } }).catch(() => ({ data: null }));
  heatmapRaw.value = (data?.activityByDay ?? {}) as HeatmapRawData;
  heatmapLoading.value = false;
};

watch(statsRange, () => {
  fetchStats();
});

watch(activityTypeFilter, () => {
  refetchActivity();
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

    <div class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-red-400/20 bg-red-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-red-300/70">Sentences Searched</p>
        <p class="mt-2 text-2xl font-semibold text-red-200">{{ stats?.totalSearches ?? 0 }}</p>
      </div>
      <div class="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-emerald-300/70">Audios Played</p>
        <p class="mt-2 text-2xl font-semibold text-emerald-200">{{ stats?.totalPlays ?? 0 }}</p>
      </div>
      <div class="rounded-lg border border-blue-400/20 bg-blue-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-blue-300/70">Anki Exports</p>
        <p class="mt-2 text-2xl font-semibold text-blue-200">{{ stats?.totalExports ?? 0 }}</p>
      </div>
      <div class="rounded-lg border border-purple-400/20 bg-purple-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-purple-300/70">Links Shared</p>
        <p class="mt-2 text-2xl font-semibold text-purple-200">{{ stats?.totalShares ?? 0 }}</p>
      </div>
    </div>
  </div>

  <!-- Activity Heatmap -->
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">Activity Heatmap</h3>
        <p class="text-sm text-gray-400 mt-1">Activity over the last {{ HEATMAP_DAYS }} days. Click a day to filter history.</p>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        :class="[
          'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
          heatmapFilter === null
            ? 'border-white/30 bg-white/15 text-white'
            : 'border-white/15 bg-white/5 text-gray-300/60 hover:text-white hover:bg-white/10',
        ]"
        @click="heatmapFilter = null"
      >
        All
      </button>
      <button
        v-for="type in ACTIVITY_TYPES"
        :key="type"
        :class="[
          'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
          heatmapFilter === type
            ? activityTypeClass(type)
            : activityTypeMutedClass(type),
        ]"
        @click="heatmapFilter = heatmapFilter === type ? null : type"
      >
        {{ activityTypeLabel(type) }}
      </button>
    </div>

    <div v-if="heatmapLoading" class="mt-4 text-gray-400">Loading heatmap...</div>
    <div
      v-else
      class="heatmap mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-4 sm:p-5"
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
                :title="`${day.label}: ${heatmapTooltipUnit(day.count)}`"
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
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[0]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[1]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[2]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[3]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[4]]" />
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

      <div v-if="selectedDay" class="flex items-center gap-2">
        <div
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
        <button
          class="px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm hover:bg-red-500/20 hover:text-red-200 transition-colors disabled:opacity-50"
          :disabled="clearingDay || activities.length === 0"
          title="Delete all activity for this day"
          @click="clearDayActivity"
        >
          {{ clearingDay ? $t('activity.deletingDayActivity') : $t('activity.deleteDayActivity') }}
        </button>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-1.5">
      <button
        :class="[
          'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
          activityTypeFilter === null
            ? 'border-white/30 bg-white/15 text-white'
            : 'border-white/15 bg-white/5 text-gray-300/60 hover:text-white hover:bg-white/10',
        ]"
        @click="activityTypeFilter = null"
      >
        All
      </button>
      <button
        v-for="type in ACTIVITY_TYPES"
        :key="type"
        :class="[
          'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
          activityTypeFilter === type
            ? activityTypeClass(type)
            : activityTypeMutedClass(type),
        ]"
        @click="activityTypeFilter = activityTypeFilter === type ? null : type"
      >
        {{ activityTypeLabel(type) }}
      </button>
    </div>

    <div v-if="loadingActivities" class="mt-4 text-gray-400">Loading...</div>
    <div v-else-if="groupedActivities.length === 0" class="mt-4 text-gray-400">No activity recorded{{ selectedDay ? ' for this day' : activityTypeFilter ? ' for this type' : ' yet' }}.</div>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="w-full text-sm table-fixed">
        <thead>
          <tr class="border-b border-white/10 text-left">
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium w-28">Type</th>
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium">Details</th>
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium text-right w-36">Date</th>
            <th class="pb-2 w-8" />
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr
            v-for="activity in groupedActivities"
            :key="activity.id"
            class="group"
          >
            <td class="py-2.5 pr-4 whitespace-nowrap">
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                  activityTypeClass(activity.activityType),
                ]"
              >
                {{ activityTypeLabel(activity.activityType) }}
                <span v-if="activity.count > 1" class="opacity-70">&times;{{ activity.count }}</span>
              </span>
            </td>
            <td class="py-2.5 pr-4 truncate">
              <a
                v-if="activity.searchQuery"
                :href="`/search/${encodeURIComponent(activity.searchQuery)}`"
                class="text-gray-200 hover:text-white hover:underline truncate inline-block max-w-full"
              >
                {{ activity.searchQuery }}
              </a>
              <a
                v-else-if="(activity.activityType === 'SEGMENT_PLAY' || activity.activityType === 'SHARE' || activity.activityType === 'ANKI_EXPORT') && activity.segmentId && (activity.mediaName || activity.japaneseText)"
                :href="`/sentence/${activity.segmentId}`"
                class="text-gray-200 hover:text-white hover:underline truncate inline-block max-w-full"
              >
                <span v-if="activity.mediaName" class="text-gray-400">{{ activity.mediaName }}</span>
                <span v-if="activity.mediaName && activity.japaneseText" class="text-gray-600 mx-1">—</span>
                <span v-if="activity.japaneseText">{{ stripTags(activity.japaneseText) }}</span>
              </a>
              <span v-else class="text-gray-500">-</span>
            </td>
            <td class="py-2.5 pr-4 text-right text-gray-400 text-xs whitespace-nowrap">
              {{ formatDate(activity.createdAt) }}
            </td>
            <td class="py-2.5 text-center w-8">
              <button
                class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all disabled:opacity-30"
                title="Remove"
                :disabled="activity.ids.some(id => deletingIds.has(id))"
                @click="activity.ids.forEach(id => deleteActivity(id))"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
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
          class="bg-button-danger-main hover:bg-button-danger-hover text-white text-sm font-medium py-1.5 px-3 rounded disabled:opacity-50"
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
