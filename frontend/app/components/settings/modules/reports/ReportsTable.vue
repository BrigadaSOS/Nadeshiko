<script setup lang="ts">
import { buildMediaSearchPath, buildSentencePath } from '~/utils/routes';
import {
  formatDate,
  formatNumber,
  formatRelativeDate,
  type ReportGroup,
  sourceClass,
  statusClass,
} from './reportHelpers';

const props = defineProps<{
  groups: ReportGroup[];
  isLoading: boolean;
  hasMore: boolean;
  expandedGroups: Set<number>;
  selectedIndices: Set<number>;
  /** Notes drafts keyed by report id; edited in place and read back by the parent on save. */
  editingNotes: Record<number, string>;
}>();

const emit = defineEmits<{
  'toggle-expand': [idx: number];
  'toggle-select': [idx: number];
  'toggle-select-all': [];
  'update-status': [reportId: number, status: string];
  'delete-report': [reportId: number];
  'save-notes': [reportId: number];
  'load-more': [];
}>();

const { t, locale } = useI18n();
const localePath = useLocalePath();

const statusLabel = (status: string) => t(`reports.statuses.${status}`);
const sourceLabel = (source: string) => t(`reports.admin.sources.${source}`);
const targetTypeLabel = (type: string) => t(`reports.admin.targetTypes.${type}`);
const reportReasonLabel = (reason: string) => t(`reports.reasons.${reason}`);

const reportTargetSearchPath = (target: ReportGroup['target']) =>
  localePath(buildMediaSearchPath(target.mediaPublicId, 'episodeNumber' in target ? target.episodeNumber : undefined));

const allVisibleSelected = computed(() => {
  return props.groups.length > 0 && props.groups.every((_, i) => props.selectedIndices.has(i));
});

const startEditNotes = (reportId: number, adminNotes: string | null | undefined) => {
  props.editingNotes[reportId] = adminNotes || '';
};
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-neutral-700">
    <table class="w-full text-sm text-left text-gray-300">
      <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
        <tr>
          <th class="px-3 py-3 w-8">
            <input type="checkbox" :checked="allVisibleSelected" class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer" @change="emit('toggle-select-all')" />
          </th>
          <th class="px-3 py-3 w-8" />
          <th class="px-3 py-3">{{ t('reports.table.type') }}</th>
          <th class="px-3 py-3">{{ t('reports.table.target') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.count') }}</th>
          <th class="px-3 py-3">{{ t('reports.table.status') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.reported') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.updated') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(group, idx) in groups" :key="idx">
          <tr
            class="border-b border-neutral-700 hover:bg-neutral-800/50 cursor-pointer"
            data-testid="report-row"
            @click="emit('toggle-expand', idx)"
          >
            <td class="px-3 py-3 w-8" @click.stop>
              <input type="checkbox" :checked="selectedIndices.has(idx)" class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer" @change="emit('toggle-select', idx)" />
            </td>
            <td class="px-3 py-3 w-8 text-neutral-500">
              <span class="inline-block transition-transform" :class="expandedGroups.has(idx) ? 'rotate-90' : ''">&#9654;</span>
            </td>
            <td class="px-3 py-3">
              <span
                class="px-2 py-1 text-xs font-medium rounded border"
                :class="group.target.type === 'SEGMENT' ? 'bg-purple-500/20 text-purple-400 border-purple-600' : group.target.type === 'EPISODE' ? 'bg-amber-500/20 text-amber-400 border-amber-600' : 'bg-teal-500/20 text-teal-400 border-teal-600'"
              >
                {{ targetTypeLabel(group.target.type) }}
              </span>
            </td>
            <td class="px-3 py-3 text-xs max-w-[250px]" :title="group.mediaName || group.target.mediaPublicId">
              <template v-if="group.target.mediaPublicId">
                <NuxtLink
                  :to="reportTargetSearchPath(group.target)"
                  class="block truncate font-medium text-white hover:text-purple-300 underline"
                  @click.stop
                >
                  {{ group.mediaName || group.target.mediaPublicId }}
                </NuxtLink>
                <span v-if="group.target.type !== 'MEDIA' && group.target.episodeNumber" class="text-neutral-400">{{ t('reports.admin.episode', { number: group.target.episodeNumber }) }}</span>
                <NuxtLink
                  v-if="group.target.type === 'SEGMENT' && group.target.segmentPublicId"
                  :to="localePath(buildSentencePath(group.target.segmentPublicId))"
                  class="block text-purple-400 hover:text-purple-300 underline truncate"
                  :title="group.target.segmentPublicId"
                  @click.stop
                >
                  {{ group.target.segmentPublicId }}
                </NuxtLink>
              </template>
              <span v-else class="text-red-400 italic">{{ t('reports.admin.deletedTarget') }}</span>
            </td>
            <td class="px-3 py-3 text-center">
              <span class="px-2 py-1 text-xs font-bold rounded bg-neutral-700 text-white">{{ formatNumber(group.reportCount, locale) }}</span>
              <span
                v-if="group.reporterCount > 0"
                class="block text-[10px] text-neutral-500 mt-0.5 cursor-help"
                :title="[...new Set(group.reports.map(r => r.reporterName))].join(', ')"
              >
                {{ t('reports.admin.reporters', { count: formatNumber(group.reporterCount, locale) }) }}
              </span>
            </td>
            <td class="px-3 py-3">
              <span class="px-2 py-1 text-xs font-medium rounded border" :class="statusClass(group.status)">{{ statusLabel(group.status) }}</span>
            </td>
            <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap" :title="formatDate(group.firstReportedAt, locale)">
              {{ formatRelativeDate(group.firstReportedAt, locale) }}
            </td>
            <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap" :title="group.lastStatusChange ? formatDate(group.lastStatusChange, locale) : ''">
              {{ group.lastStatusChange ? formatRelativeDate(group.lastStatusChange, locale) : '-' }}
            </td>
            <td class="px-3 py-3" @click.stop>
              <div v-if="group.reports[0]" class="flex gap-1 flex-wrap">
                <button class="px-2 py-1 text-xs rounded bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/50" @click="emit('update-status', group.reports[0]!.id, 'OPEN')">{{ statusLabel('OPEN') }}</button>
                <button class="px-2 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50" @click="emit('update-status', group.reports[0]!.id, 'PROCESSING')">{{ statusLabel('PROCESSING') }}</button>
                <button class="px-2 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50" @click="emit('update-status', group.reports[0]!.id, 'FIXED')">{{ statusLabel('FIXED') }}</button>
                <button class="px-2 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50" @click="emit('update-status', group.reports[0]!.id, 'DISMISSED')">{{ t('reports.admin.dismiss') }}</button>
                <button class="px-2 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50" @click="emit('delete-report', group.reports[0]!.id)">{{ t('reports.admin.delete') }}</button>
              </div>
            </td>
          </tr>

          <tr v-if="expandedGroups.has(idx)" v-for="report in group.reports" :key="report.id" class="bg-neutral-900/50 border-b border-neutral-800">
            <td colspan="2" />
            <td colspan="2" class="px-3 py-2 text-xs">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 text-[10px] font-medium rounded border" :class="sourceClass(report.source)">{{ sourceLabel(report.source) }}</span>
                <span class="font-medium text-neutral-300">{{ reportReasonLabel(report.reason) }}</span>
              </div>
              <span v-if="report.description" class="block text-neutral-500 truncate max-w-[300px] mt-0.5" :title="report.description">{{ report.description }}</span>
            </td>
            <td class="px-3 py-2 text-xs text-neutral-300">{{ report.reporterName }}</td>
            <td />
            <td class="px-3 py-2 text-xs text-gray-500" :title="formatDate(report.createdAt, locale)">{{ formatRelativeDate(report.createdAt, locale) }}</td>
            <td class="px-3 py-2 max-w-[150px]">
              <template v-if="editingNotes[report.id] !== undefined">
                <input
                  v-model="editingNotes[report.id]"
                  class="w-full rounded border border-neutral-600 bg-neutral-800 text-white px-2 py-1 text-xs"
                  @keyup.enter="emit('save-notes', report.id)"
                  @keyup.escape="delete editingNotes[report.id]"
                />
                <button class="text-xs text-blue-400 hover:text-blue-300 mt-1" @click="emit('save-notes', report.id)">{{ t('reports.admin.save') }}</button>
              </template>
              <template v-else>
                <span class="text-xs cursor-pointer hover:text-white truncate block max-w-[130px]" :title="report.adminNotes || ''" @click="startEditNotes(report.id, report.adminNotes)">
                  {{ report.adminNotes || t('reports.admin.addNote') }}
                </span>
              </template>
            </td>
            <td />
          </tr>
        </template>
        <tr v-if="groups.length === 0 && !isLoading">
          <td colspan="9" class="px-4 py-8 text-center text-gray-500">
            {{ t('reports.noReports') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="hasMore" class="mt-4 text-center">
    <button
      :disabled="isLoading"
      class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-50"
      @click="emit('load-more')"
    >
      {{ isLoading ? t('reports.loading') : t('reports.loadMore') }}
    </button>
  </div>

  <div v-if="isLoading && groups.length === 0" class="text-center py-8">
    <div
      class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full"
      role="status"
    />
  </div>
</template>
