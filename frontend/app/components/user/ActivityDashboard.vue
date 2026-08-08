<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityItem,
  type ActivityStats,
  formatDayLabel,
  HEATMAP_DAYS,
  type HeatmapRawData,
  sinceForRange,
  type StatsRange,
} from './activity/activityHelpers';

const { t, locale } = useI18n();
const sdk = useNadeshikoSdk();

// Each panel renders its own empty state when its slice of the initial load
// fails, so the failure is reported without stacking four toasts on the user.
function reportInitialFailure(slice: string) {
  return (err: unknown) => {
    handleApiError(`activity.initial.${slice}`, err, { toastKey: false });
    return null;
  };
}

const { data: initialData } = await useAsyncData(
  'settings-activity-initial',
  async () => {
    const since7d = sinceForRange('7d');
    const [statsRes, activityRes, heatmapRes] = await Promise.all([
      sdk.getUserActivityStats(since7d ? { since: since7d } : {}).catch(reportInitialFailure('stats')),
      sdk.listUserActivity({ take: ACTIVITY_PAGE_SIZE }).catch(reportInitialFailure('activity')),
      sdk.getUserActivityHeatmap({ days: HEATMAP_DAYS }).catch(reportInitialFailure('heatmap')),
    ]);

    // Preferences are already in the store -- the SSR identity bootstrap loads
    // them alongside the session, and this page is only reachable signed in. The
    // fourth request here re-fetched what hydration had just delivered. An
    // absent value reads as enabled, which is the same default the failed fetch
    // used to produce.
    const prefs = userStore().preferences as Record<string, any> | undefined;

    return {
      stats: statsRes as ActivityStats | null,
      activities: (activityRes?.activities ?? []) as ActivityItem[],
      hasMore: activityRes?.pagination?.hasMore ?? false,
      cursor: activityRes?.pagination?.cursor ?? null,
      trackingEnabled: prefs?.searchHistory?.enabled !== false,
      heatmapRaw: (heatmapRes?.activityByDay ?? {}) as HeatmapRawData,
    };
  },
  {
    // Server-rendered. These routes are off the public allowlist, so the SDK
    // sends the reader's session cookie rather than the service key -- which is
    // what this was `server: false` to avoid. The `/user/**` route guard runs
    // before setup, so it only ever executes for someone signed in.
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
const {
  hasMore,
  loading: loadingActivities,
  loadingMore,
  load: loadActivityPage,
  loadMore: fetchNextActivityPage,
  seed: seedActivityPagination,
} = useCursorPagination();
seedActivityPagination(initialData.value);
const trackingEnabled = ref(initialData.value.trackingEnabled);
const togglingTracking = ref(false);
const clearingHistory = ref(false);
const heatmapLoading = ref(false);
const heatmapFilter = ref<string | null>(null);
const heatmapRaw = ref<HeatmapRawData>(initialData.value.heatmapRaw);
const selectedDay = ref<string | null>(null);
const activityTypeFilter = ref<string | null>(null);

// The SSR pass seeds the refs above directly now; this still fires for the
// explicit refreshes (`refetchActivity`, range changes) that replace `initialData`.
watch(initialData, (data) => {
  stats.value = data.stats;
  activities.value = data.activities;
  seedActivityPagination(data);
  trackingEnabled.value = data.trackingEnabled;
  heatmapRaw.value = data.heatmapRaw;
});

const fetchTrackingState = async () => {
  const data = await sdk.getUserPreferences().catch((err) => {
    handleApiError('activity.fetchTrackingState', err, { toastKey: false });
    return null;
  });
  const prefs = data as Record<string, any> | null;
  trackingEnabled.value = prefs?.searchHistory?.enabled !== false;
};

const fetchStats = async () => {
  const since = sinceForRange(statsRange.value);
  const data = await sdk.getUserActivityStats(since ? { since } : {}).catch((err) => {
    handleApiError('activity.fetchStats', err, { toastKey: false });
    return null;
  });
  stats.value = data as ActivityStats | null;
};

const fetchActivityPage = async (cursor: string | null) => {
  const query: Record<string, any> = { take: ACTIVITY_PAGE_SIZE };
  if (cursor) query.cursor = cursor;
  if (selectedDay.value) query.date = selectedDay.value;
  if (activityTypeFilter.value) query.activityType = activityTypeFilter.value;

  const data = await sdk.listUserActivity(query).catch((err) => {
    handleApiError('activity.fetchActivity', err, { toastKey: false });
    return null;
  });
  if (!data) return null;

  return {
    activities: (data.activities ?? []) as ActivityItem[],
    hasMore: data.pagination?.hasMore ?? false,
    cursor: data.pagination?.cursor ?? null,
  };
};

const refetchActivity = async () => {
  const outcome = await loadActivityPage(fetchActivityPage);
  if (outcome.status === 'stale') return;
  // A failed refetch must not leave the previous day/type filter's rows on screen.
  activities.value = outcome.status === 'ok' ? outcome.page.activities : [];
};

const loadMore = async () => {
  const outcome = await fetchNextActivityPage(fetchActivityPage);
  if (outcome.status !== 'ok') return;
  activities.value.push(...outcome.page.activities);
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
    await sdk.updateUserPreferences({ searchHistory: { enabled: newValue } });
    trackingEnabled.value = newValue;
    // Write through to the store, which is now what the initial load reads. The
    // same pattern the other preference surfaces use (see `useHiddenMedia`):
    // without it, leaving this page and coming back would show the old value.
    const user = userStore();
    user.preferences = { ...(user.preferences ?? {}), searchHistory: { enabled: newValue } };
    const posthog = usePostHog();
    posthog?.capture('activity_tracking_toggled', { enabled: newValue });
  } catch (error) {
    handleApiError('activity.toggleTracking', error);
  } finally {
    togglingTracking.value = false;
  }
};

const clearHistory = async () => {
  if (clearingHistory.value) return;
  if (!confirm(t('accountSettings.activity.confirmClearHistory'))) return;
  clearingHistory.value = true;
  try {
    await sdk.deleteUserActivity();
    activities.value = [];
    seedActivityPagination(null);
    selectedDay.value = null;
    heatmapRaw.value = {};
    await fetchStats();
    await loadHeatmap();
  } catch (error) {
    handleApiError('activity.clearHistory', error);
  } finally {
    clearingHistory.value = false;
  }
};

const deletingIds = ref<Set<number>>(new Set());

const deleteActivity = async (id: number) => {
  if (deletingIds.value.has(id)) return;
  deletingIds.value.add(id);
  try {
    await sdk.deleteUserActivityById(id);
    activities.value = activities.value.filter((a) => a.id !== id);
  } catch (error) {
    handleApiError('activity.deleteActivity', error);
  } finally {
    deletingIds.value.delete(id);
  }
};

const clearingDay = ref(false);

const clearDayActivity = async () => {
  if (!selectedDay.value || clearingDay.value) return;
  if (!confirm(t('accountSettings.activity.confirmClearDay', { day: formatDayLabel(selectedDay.value, locale.value) })))
    return;

  clearingDay.value = true;
  try {
    await sdk.deleteUserActivityByDate(selectedDay.value);
    activities.value = [];
    seedActivityPagination(null);
    const updated = { ...heatmapRaw.value };
    delete updated[selectedDay.value];
    heatmapRaw.value = updated;
    await fetchStats();
  } catch (error) {
    handleApiError('activity.clearDayActivity', error);
  } finally {
    clearingDay.value = false;
  }
};

const loadHeatmap = async () => {
  heatmapLoading.value = true;
  const data = await sdk.getUserActivityHeatmap({ days: HEATMAP_DAYS }).catch((err) => {
    handleApiError('activity.loadHeatmap', err, { toastKey: false });
    return null;
  });
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
  await Promise.all([fetchTrackingState(), fetchStats(), refetchActivity()]);
});
</script>

<template>
  <UserActivityStatsCards :stats="stats" v-model:range="statsRange" />

  <UserActivityHeatmap
    :raw="heatmapRaw"
    :loading="heatmapLoading"
    v-model:filter="heatmapFilter"
    :selected-day="selectedDay"
    @select-day="selectDay"
  />

  <UserActivityHistory
    :activities="activities"
    :loading="loadingActivities"
    :loading-more="loadingMore"
    :has-more="hasMore"
    :selected-day="selectedDay"
    v-model:type-filter="activityTypeFilter"
    :clearing-day="clearingDay"
    :deleting-ids="deletingIds"
    @clear-day-filter="clearDayFilter"
    @clear-day-activity="clearDayActivity"
    @load-more="loadMore"
    @delete="(ids) => ids.forEach((id) => deleteActivity(id))"
  />

  <UserActivityPrivacy
    :tracking-enabled="trackingEnabled"
    :toggling="togglingTracking"
    :clearing="clearingHistory"
    @toggle-tracking="toggleTracking"
    @clear-history="clearHistory"
  />
</template>
