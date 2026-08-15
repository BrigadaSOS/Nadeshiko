<script setup lang="ts">
import { buildSentencePath, buildScopedSearchPath } from '~/utils/routes';
import { type ActivityItem, activityTypeClass, activityTypeLabel, formatDayLabel } from './activityHelpers';

const props = defineProps<{
  activities: ActivityItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  selectedDay: string | null;
  typeFilter: string | null;
  clearingDay: boolean;
  deletingIds: Set<number>;
}>();

const emit = defineEmits<{
  'update:typeFilter': [type: string | null];
  'clear-day-filter': [];
  'clear-day-activity': [];
  'load-more': [];
  delete: [ids: number[]];
}>();

const { t, locale } = useI18n();
const { formatDate } = useFormat();
const localePath = useLocalePath();
const router = useRouter();

const stripTags = (text: string) => {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
};

type GroupedActivity = ActivityItem & { count: number; ids: number[] };

const activityHref = (activity: ActivityItem) => {
  if (activity.searchQuery) {
    return localePath(buildScopedSearchPath(activity.searchQuery, activity.mediaPublicId));
  }

  if (
    (activity.activityType === 'SEGMENT_PLAY' ||
      activity.activityType === 'SHARE' ||
      activity.activityType === 'ANKI_EXPORT') &&
    activity.segmentPublicId &&
    (activity.mediaName || activity.japaneseText)
  ) {
    return localePath(buildSentencePath(activity.segmentPublicId));
  }

  return null;
};

const openActivity = (activity: ActivityItem) => {
  const href = activityHref(activity);
  if (href) void router.push(href);
};

const groupedActivities = computed<GroupedActivity[]>(() => {
  const groups: GroupedActivity[] = [];
  for (const item of props.activities) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.activityType === item.activityType &&
      prev.segmentPublicId === item.segmentPublicId &&
      prev.searchQuery === item.searchQuery &&
      // The title a search was run inside is part of which search it was, so
      // the same query across everything and inside one show stay two rows here
      // as well as in the bar's recents menu.
      prev.mediaPublicId === item.mediaPublicId
    ) {
      prev.count++;
      prev.ids.push(item.id);
    } else {
      groups.push({ ...item, count: 1, ids: [item.id] });
    }
  }
  return groups;
});
</script>

<template>
  <div class="nd-settings-card">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="nd-settings-title">{{ t('accountSettings.activity.history.title') }}</h3>
        <p class="text-sm text-gray-400 mt-1">{{ t('accountSettings.activity.history.description') }}</p>
      </div>

      <div v-if="selectedDay" class="flex items-center gap-2">
        <div
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-400/40 bg-red-500/10 text-red-300 text-sm"
        >
          <span>{{ t('accountSettings.activity.history.showing', { day: formatDayLabel(selectedDay, locale) }) }}</span>
          <button
            class="hover:text-white transition-colors ml-1"
            :title="t('accountSettings.activity.history.clearDayFilter')"
            @click="emit('clear-day-filter')"
          >
            &times;
          </button>
        </div>
        <button
          class="px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm hover:bg-red-500/20 hover:text-red-200 transition-colors disabled:opacity-50"
          :disabled="clearingDay || activities.length === 0"
          :title="t('accountSettings.activity.history.deleteDayTitle')"
          @click="emit('clear-day-activity')"
        >
          {{ clearingDay ? $t('activity.deletingDayActivity') : $t('activity.deleteDayActivity') }}
        </button>
      </div>
    </div>

    <UserActivityTypeFilter
      class="mt-4"
      :model-value="typeFilter"
      @update:model-value="emit('update:typeFilter', $event)"
    />

    <div v-if="loading" class="mt-4 text-gray-400">{{ t('accountSettings.activity.history.loading') }}</div>
    <div v-else-if="groupedActivities.length === 0" class="mt-4 text-gray-400">
      {{
        selectedDay
          ? t('accountSettings.activity.history.emptyForDay')
          : typeFilter
            ? t('accountSettings.activity.history.emptyForType')
            : t('accountSettings.activity.history.empty')
      }}
    </div>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="w-full text-sm table-fixed">
        <thead>
          <tr class="border-b border-white/10 text-left">
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium w-28">{{ t('accountSettings.activity.history.table.type') }}</th>
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium">{{ t('accountSettings.activity.history.table.details') }}</th>
            <th class="pb-2 pr-4 text-xs uppercase tracking-wide text-gray-400 font-medium text-right w-36">{{ t('accountSettings.activity.history.table.date') }}</th>
            <th class="pb-2 w-8" />
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr
            v-for="activity in groupedActivities"
            :key="activity.id"
            :class="[
              'group transition-colors',
              activityHref(activity) && 'cursor-pointer hover:bg-white/5 focus-within:bg-white/5',
            ]"
            :role="activityHref(activity) ? 'link' : undefined"
            :tabindex="activityHref(activity) ? 0 : undefined"
            @click="openActivity(activity)"
            @keydown.enter="openActivity(activity)"
            @keydown.space.prevent="openActivity(activity)"
          >
            <td class="py-2.5 pr-4 whitespace-nowrap">
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                  activityTypeClass(activity.activityType),
                ]"
              >
                {{ activityTypeLabel(activity.activityType, t) }}
                <span v-if="activity.count > 1" class="opacity-70">&times;{{ activity.count }}</span>
              </span>
            </td>
            <td class="py-2.5 pr-4">
              <div
                v-if="activity.searchQuery"
                class="flex min-w-0 items-center gap-2"
              >
                <span class="min-w-0 truncate text-gray-200 group-hover:text-white">{{ activity.searchQuery }}</span>
                <span
                  v-if="activity.mediaPublicId"
                  class="inline-flex max-w-[12rem] flex-shrink-0 items-center truncate rounded-full border border-hairline bg-lift-strong px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                >
                  {{ activity.mediaName || t('accountSettings.activity.history.inOneTitle') }}
                </span>
              </div>
              <div
                v-else-if="(activity.activityType === 'SEGMENT_PLAY' || activity.activityType === 'SHARE' || activity.activityType === 'ANKI_EXPORT') && activity.segmentPublicId && (activity.mediaName || activity.japaneseText)"
                class="flex min-w-0 items-center gap-2"
              >
                <span v-if="activity.japaneseText" class="min-w-0 truncate text-gray-200 group-hover:text-white">{{ stripTags(activity.japaneseText) }}</span>
                <span
                  v-if="activity.mediaName"
                  class="inline-flex max-w-[12rem] flex-shrink-0 items-center truncate rounded-full border border-hairline bg-lift-strong px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                >{{ activity.mediaName }}</span>
              </div>
              <span v-else class="text-gray-500">{{ t('accountSettings.activity.history.noDetails') }}</span>
            </td>
            <td class="py-2.5 pr-4 text-right text-gray-400 text-xs whitespace-nowrap">
              {{ formatDate(activity.createdAt, 'dateTime') }}
            </td>
            <td class="py-2.5 text-center w-8">
              <button
                class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all disabled:opacity-30"
                :title="t('accountSettings.activity.history.remove')"
                :disabled="activity.ids.some(id => deletingIds.has(id))"
                @click.stop="emit('delete', activity.ids)"
                @keydown.stop
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
        @click="emit('load-more')"
      >
        {{ loadingMore ? t('accountSettings.activity.history.loading') : t('accountSettings.activity.history.loadMore') }}
      </button>
    </div>
  </div>
</template>
