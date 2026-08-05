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
    const [statsRes, activityRes, prefsRes, heatmapRes] = await Promise.all([
      sdk.getUserActivityStats(since7d ? { since: since7d } : {}).catch(reportInitialFailure('stats')),
      sdk.listUserActivity({ take: ACTIVITY_PAGE_SIZE }).catch(reportInitialFailure('activity')),
      sdk.getUserPreferences().catch(reportInitialFailure('preferences')),
      sdk.getUserActivityHeatmap({ days: HEATMAP_DAYS }).catch(reportInitialFailure('heatmap')),
    ]);

    const prefsData = prefsRes as Record<string, any> | null;

    return {
      stats: statsRes as ActivityStats | null,
      activities: (activityRes?.activities ?? []) as ActivityItem[],
      hasMore: activityRes?.pagination?.hasMore ?? false,
      cursor: activityRes?.pagination?.cursor ?? null,
      trackingEnabled: prefsData?.searchHistory?.enabled !== false,
      heatmapRaw: (heatmapRes?.activityByDay ?? {}) as HeatmapRawData,
    };
  },
  {
    // Session-scoped: an SSR call would carry the shared API key instead of the
    // user's session, so it can only return the wrong data.
    server: false,
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

// With `server: false` the fetch is deferred to the client during hydration, so
// the data can land after the local copies above were seeded.
watch(initialData, (data) => {
  stats.value = data.stats;
  activities.value = data.activities;
  hasMore.value = data.hasMore;
  activityCursor.value = data.cursor;
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

const fetchActivity = async (append = false) => {
  const query: Record<string, any> = { take: ACTIVITY_PAGE_SIZE };
  if (append && activityCursor.value) query.cursor = activityCursor.value;
  if (selectedDay.value) query.date = selectedDay.value;
  if (activityTypeFilter.value) query.activityType = activityTypeFilter.value;

  const data = await sdk.listUserActivity(query).catch((err) => {
    handleApiError('activity.fetchActivity', err, { toastKey: false });
    return null;
  });

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
    await sdk.updateUserPreferences({ searchHistory: { enabled: newValue } });
    trackingEnabled.value = newValue;
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
    hasMore.value = false;
    activityCursor.value = null;
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
    hasMore.value = false;
    activityCursor.value = null;
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
  await Promise.all([fetchTrackingState(), fetchStats(), fetchActivity()]);
});
</script>

<template>
  <SettingsModulesActivityStatsCards :stats="stats" v-model:range="statsRange" />

  <SettingsModulesActivityHeatmap
    :raw="heatmapRaw"
    :loading="heatmapLoading"
    v-model:filter="heatmapFilter"
    :selected-day="selectedDay"
    @select-day="selectDay"
  />

  <SettingsModulesActivityHistory
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

  <SettingsModulesActivityPrivacy
    :tracking-enabled="trackingEnabled"
    :toggling="togglingTracking"
    :clearing="clearingHistory"
    @toggle-tracking="toggleTracking"
    @clear-history="clearHistory"
  />
</template>
