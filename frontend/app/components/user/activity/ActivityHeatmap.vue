<script setup lang="ts">
import { HEATMAP_DAYS, HEATMAP_PALETTES, type HeatmapRawData, startOfDay, toDayKey } from './activityHelpers';

const props = defineProps<{
  raw: HeatmapRawData;
  loading: boolean;
  filter: string | null;
  selectedDay: string | null;
}>();

const emit = defineEmits<{
  'update:filter': [type: string | null];
  'select-day': [dayKey: string];
}>();

const { t, locale } = useI18n();
const { formatDate } = useFormat();

const DAY_LABELS = computed(() => {
  const base = new Date('2024-01-01T00:00:00');
  return Array.from({ length: 7 }, (_, index) => {
    if (![0, 2, 4].includes(index)) return '';
    const date = new Date(base);
    date.setDate(base.getDate() + index);
    return new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(date);
  });
});

const MONTH_NAMES = computed(() =>
  Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(new Date(2024, month, 1)),
  ),
);

const heatmapCountsByDay = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const [day, types] of Object.entries(props.raw)) {
    if (props.filter) {
      result[day] = types[props.filter] ?? 0;
    } else {
      let total = 0;
      for (const count of Object.values(types)) total += count;
      result[day] = total;
    }
  }
  return result;
});

const heatmapTooltipUnit = (count: number): string => {
  if (!props.filter) return t('accountSettings.activity.heatmap.records', { count });
  const units: Record<string, string> = {
    SEARCH: 'searches',
    SEGMENT_PLAY: 'plays',
    ANKI_EXPORT: 'exports',
    SHARE: 'shares',
  };
  return t(`accountSettings.activity.heatmap.${units[props.filter] ?? 'actions'}`, { count });
};

const activePalette = computed(() => {
  const key = (props.filter ?? 'default') as keyof typeof HEATMAP_PALETTES;
  return HEATMAP_PALETTES[key] ?? HEATMAP_PALETTES.default;
});

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
      currentGroup = { label: MONTH_NAMES.value[m] ?? '', days: [] };
      groups.push(currentGroup);
      currentMonth = m;
    }

    const key = toDayKey(cursor);
    currentGroup?.days.push({
      key,
      count: heatmapCountsByDay.value[key] ?? 0,
      label: formatDate(cursor, 'short'),
      dayOfWeek: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return groups;
});
</script>

<template>
  <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md border border-white/10">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.activity.heatmap.title') }}</h3>
        <p class="text-sm text-gray-400 mt-1">{{ t('accountSettings.activity.heatmap.description', { days: HEATMAP_DAYS }) }}</p>
      </div>
    </div>

    <UserActivityTypeFilter
      class="mt-3"
      :model-value="filter"
      @update:model-value="emit('update:filter', $event)"
    />

    <div v-if="loading" class="mt-4 text-gray-400">{{ t('accountSettings.activity.heatmap.loading') }}</div>
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
                @click="emit('select-day', day.key)"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <span>{{ t('accountSettings.activity.heatmap.less') }}</span>
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[0]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[1]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[2]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[3]]" />
        <span :class="['heatmap-legend-cell rounded-sm border', activePalette[4]]" />
        <span>{{ t('accountSettings.activity.heatmap.more') }}</span>
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
