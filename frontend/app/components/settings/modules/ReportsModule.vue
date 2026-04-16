<script setup lang="ts">
import type { MediaAudit, MediaAuditRun } from '@brigadasos/nadeshiko-sdk';

// TODO: replace with SDK types once regenerated
type ReportGroupItem = {
  id: number;
  reason: string;
  description: string | null;
  source: string;
  reporterName: string;
  createdAt: string;
  adminNotes: string | null;
};

type ReportGroup = {
  target: { type: string; mediaId: string; episodeNumber?: number; segmentId?: string | null };
  mediaName: string;
  status: string;
  reportCount: number;
  reporterCount: number;
  firstReportedAt: string;
  lastStatusChange: string | null;
  reports: ReportGroupItem[];
};

const { t } = useI18n();
const sdk = useNadeshikoSdk();

const groups = ref<ReportGroup[]>([]);
const isLoading = ref(false);
const hasMore = ref(false);
const cursor = ref<string | null>(null);

const sourceFilter = ref<'' | 'USER' | 'AUTO'>('');
const orphanedFilter = ref(false);
const expandedGroups = ref(new Set<number>());
const selectedGroupIndices = ref(new Set<number>());
const isBatchUpdating = ref(false);
const editingNotes = ref<Record<number, string>>({});
const isBulkDismissing = ref(false);
const showDismissConfirm = ref(false);
const pendingDeleteId = ref<number | null>(null);
const isBulkDeleting = ref(false);
const showDeleteConfirm = ref(false);

const ALL_STATUSES = ['OPEN', 'PROCESSING', 'FIXED', 'DISMISSED'] as const;
const activeStatuses = ref(new Set<string>(ALL_STATUSES));

const statusFilterQuery = computed(() => {
  if (activeStatuses.value.size === 0 || activeStatuses.value.size === ALL_STATUSES.length) return '';
  return [...activeStatuses.value].join(',');
});

// For bulk operations: always include status filter (even "all") so the backend has at least one filter
const bulkStatusFilter = computed(() => {
  if (activeStatuses.value.size === 0) return '';
  return [...activeStatuses.value].join(',');
});

const toggleStatus = (status: string) => {
  const next = new Set(activeStatuses.value);
  if (next.has(status)) {
    next.delete(status);
  } else {
    next.add(status);
  }
  activeStatuses.value = next;
};

const audits = ref<MediaAudit[]>([]);
const runningAudits = ref<Set<string>>(new Set());
const runs = ref<MediaAuditRun[]>([]);

const autoSubTab = ref<'results' | 'runHistory'>('results');

const showAuditConfig = ref(false);
const editingAudit = ref<MediaAudit | null>(null);
const editThreshold = ref<Record<string, number | boolean>>({});

const buildReportQuery = (append = false) => {
  const query: Record<string, string | number | boolean> = { take: 20 };
  if (cursor.value && append) query.cursor = cursor.value;
  if (statusFilterQuery.value) query.status = statusFilterQuery.value;
  if (sourceFilter.value) query.source = sourceFilter.value;
  if (orphanedFilter.value) query.orphaned = true;
  return query;
};

const fetchReports = async (append = false) => {
  isLoading.value = true;
  try {
    const data = await $fetch<{ groups: ReportGroup[]; pagination: { hasMore: boolean; cursor: string | null } }>(
      '/v1/admin/reports',
      { query: buildReportQuery(append) },
    );
    const result = data ?? { groups: [], pagination: { hasMore: false, cursor: null } };

    if (append) {
      groups.value.push(...result.groups);
    } else {
      groups.value = result.groups;
    }
    hasMore.value = result.pagination?.hasMore ?? false;
    cursor.value = result.pagination?.cursor ?? null;
  } finally {
    isLoading.value = false;
  }
};

const fetchAudits = async () => {
  const { data } = await sdk.listAdminMediaAudits().catch(() => ({ data: null }));
  audits.value = (Array.isArray(data) ? data : []) as MediaAudit[];
};

const fetchRuns = async () => {
  try {
    const { data } = await sdk.listAdminMediaAuditRuns({ query: { take: 50 } });
    runs.value = data?.runs ?? [];
  } catch (err) {
    console.error('Failed to fetch audit runs:', err);
  }
};

// Admin pages require auth -- skip SSR data fetch, load client-side only
onMounted(() => {
  fetchReports();
  fetchAudits();
});

watch([sourceFilter, statusFilterQuery, orphanedFilter], () => {
  cursor.value = null;
  autoSubTab.value = 'results';
  selectedGroupIndices.value = new Set();
  expandedGroups.value = new Set();
  fetchReports();
});

const runAudit = async (auditName: string) => {
  runningAudits.value.add(auditName);
  try {
    const { data } = await sdk.runAdminMediaAudit({ path: { name: auditName } });
    useToastSuccess(`${auditName}: ${data?.totalReports ?? 0} findings`);
    await fetchReports();
    await fetchAudits();
  } catch {
  } finally {
    runningAudits.value.delete(auditName);
  }
};

const updateReport = async (reportId: number, status?: string, adminNotes?: string) => {
  const body: Record<string, string> = {};
  if (status !== undefined) body.status = status;
  if (adminNotes !== undefined) body.adminNotes = adminNotes;

  try {
    await $fetch(`/v1/admin/reports/${reportId}`, {
      method: 'PATCH',
      body,
    });
    // Re-fetch to get updated group state
    await fetchReports();
    useToastSuccess(t('reports.admin.updateSuccess'));
  } catch {
    useToastError('Failed to update report');
  }
};

const openAuditConfig = (audit: MediaAudit) => {
  editingAudit.value = audit;
  editThreshold.value = { ...audit.threshold } as Record<string, number | boolean>;
  showAuditConfig.value = true;
};

const saveAuditConfig = async () => {
  if (!editingAudit.value) return;

  try {
    await sdk.updateAdminMediaAudit({
      path: { name: editingAudit.value.name },
      body: {
        threshold: editThreshold.value,
      },
    });
    useToastSuccess('Audit config updated');
    showAuditConfig.value = false;
    await fetchAudits();
  } catch {}
};

const statusClass = (status: string) => {
  switch (status) {
    case 'OPEN':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-600';
    case 'PROCESSING':
      return 'bg-blue-500/20 text-blue-400 border-blue-600';
    case 'FIXED':
      return 'bg-green-500/20 text-green-400 border-green-600';
    case 'DISMISSED':
      return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
    default:
      return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
  }
};

const sourceClass = (source: string) => {
  return source === 'USER'
    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-600'
    : 'bg-cyan-500/20 text-cyan-400 border-cyan-600';
};

const startEditNotes = (report: ReportGroupItem) => {
  editingNotes.value[report.id] = report.adminNotes || '';
};

const saveNotes = async (reportId: number) => {
  const notes = editingNotes.value[reportId];
  delete editingNotes.value[reportId];
  await updateReport(reportId, undefined, notes);
};

const formatDate = (iso: string) => {
  return new Date(iso).toLocaleString();
};

const formatRelativeDate = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const toggleExpand = (idx: number) => {
  const next = new Set(expandedGroups.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  expandedGroups.value = next;
};

const allVisibleSelected = computed(() => {
  return groups.value.length > 0 && groups.value.every((_, i) => selectedGroupIndices.value.has(i));
});

const toggleSelectAll = () => {
  if (allVisibleSelected.value) {
    selectedGroupIndices.value = new Set();
  } else {
    selectedGroupIndices.value = new Set(groups.value.map((_, i) => i));
  }
};

const toggleSelectGroup = (idx: number) => {
  const next = new Set(selectedGroupIndices.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  selectedGroupIndices.value = next;
};

const selectedReportIds = computed(() => {
  const ids: number[] = [];
  for (const idx of selectedGroupIndices.value) {
    const group = groups.value[idx];
    if (group) ids.push(...group.reports.map((r) => r.id));
  }
  return ids;
});

const selectedGroupRepIds = computed(() => {
  const ids: number[] = [];
  for (const idx of selectedGroupIndices.value) {
    const group = groups.value[idx];
    if (group?.reports[0]) ids.push(group.reports[0].id);
  }
  return ids;
});

const batchUpdate = async (status: string) => {
  const ids = selectedReportIds.value;
  if (ids.length === 0) return;

  isBatchUpdating.value = true;
  try {
    const { updated } = await $fetch<{ count: number }>('/v1/admin/reports/batch', {
      method: 'PATCH',
      body: { ids, status },
    });
    selectedGroupIndices.value = new Set();
    useToastSuccess(`${updated} report(s) updated`);
    await fetchReports();
  } catch {
    useToastError('Failed to update reports');
  } finally {
    isBatchUpdating.value = false;
  }
};

const batchDelete = async () => {
  const ids = selectedGroupRepIds.value;
  if (ids.length === 0) return;

  isBatchUpdating.value = true;
  const results = await Promise.allSettled(
    ids.map((id) => $fetch<{ count: number }>(`/v1/admin/reports/${id}`, { method: 'DELETE' })),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - succeeded;

  selectedGroupIndices.value = new Set();
  if (succeeded > 0) useToastSuccess(`${succeeded} report(s) deleted`);
  if (failed > 0) useToastError(`${failed} delete(s) failed`);
  await fetchReports();
  isBatchUpdating.value = false;
};

const buildBulkFilters = () => {
  const filters: Record<string, string | boolean> = {};
  if (bulkStatusFilter.value) filters.status = bulkStatusFilter.value;
  if (sourceFilter.value) filters.source = sourceFilter.value;
  if (orphanedFilter.value) filters.orphaned = true;
  return Object.keys(filters).length > 0 ? filters : undefined;
};

const bulkDismissAllMatching = async () => {
  showDismissConfirm.value = false;
  isBulkDismissing.value = true;
  try {
    const result = await $fetch<{ count: number }>('/v1/admin/reports/bulk', {
      method: 'PATCH',
      body: {
        status: 'DISMISSED',
        filters: buildBulkFilters(),
      },
    });

    useToastSuccess(`${result.count} report(s) dismissed`);
    await fetchReports();
  } catch {
    useToastError('Failed to dismiss reports');
  } finally {
    isBulkDismissing.value = false;
  }
};

const confirmDeleteReport = (reportId: number) => {
  pendingDeleteId.value = reportId;
};

const cancelDeleteReport = () => {
  pendingDeleteId.value = null;
};

const deleteReport = async () => {
  const reportId = pendingDeleteId.value;
  if (!reportId) return;
  pendingDeleteId.value = null;

  try {
    const result = await $fetch<{ count: number }>(`/v1/admin/reports/${reportId}`, {
      method: 'DELETE',
    });
    useToastSuccess(`${result.count} report(s) deleted`);
    await fetchReports();
  } catch {
    useToastError('Failed to delete report');
  }
};

const bulkDeleteAllMatching = async () => {
  showDeleteConfirm.value = false;
  isBulkDeleting.value = true;
  try {
    const result = await $fetch<{ count: number }>('/v1/admin/reports/bulk', {
      method: 'DELETE',
      body: {
        filters: buildBulkFilters(),
      },
    });

    useToastSuccess(`${result.count} report(s) deleted`);
    await fetchReports();
  } catch {
    useToastError('Failed to delete reports');
  } finally {
    isBulkDeleting.value = false;
  }
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white" data-testid="reports-title">{{ t('reports.admin.title') }}</h1>
    </div>

    <div class="flex flex-wrap items-center gap-3 mb-4">
      <div class="flex rounded-lg border border-neutral-600 overflow-hidden">
        <button
          class="px-3 py-2 text-sm"
          :class="sourceFilter === '' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
          @click="sourceFilter = ''"
        >
          All
        </button>
        <button
          class="px-3 py-2 text-sm border-l border-neutral-600"
          :class="sourceFilter === 'USER' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
          @click="sourceFilter = 'USER'"
        >
          User Reports
        </button>
        <button
          class="px-3 py-2 text-sm border-l border-neutral-600"
          :class="sourceFilter === 'AUTO' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
          @click="sourceFilter = 'AUTO'"
        >
          Auto Checks
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="status in ALL_STATUSES"
          :key="status"
          class="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all duration-150 cursor-pointer"
          :class="activeStatuses.has(status) ? statusClass(status) : 'border-neutral-700 text-neutral-600 bg-neutral-800/50'"
          @click="toggleStatus(status)"
        >
          {{ status }}
        </button>
      </div>

      <button
        class="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all duration-150 cursor-pointer"
        :class="orphanedFilter ? 'bg-red-500/20 text-red-400 border-red-600' : 'border-neutral-700 text-neutral-600 bg-neutral-800/50'"
        data-testid="orphaned-filter"
        @click="orphanedFilter = !orphanedFilter"
      >
        Orphaned
      </button>
    </div>

    <!-- Audit Cards (Auto tab) -->
    <div v-if="sourceFilter === 'AUTO'" class="mb-4">
      <div class="mb-3">
        <span class="text-sm text-gray-400">Available checks</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div
          v-for="audit in audits"
          :key="audit.name"
          class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 transition-colors"
        >
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-white truncate">{{ audit.label }}</span>
              </div>
              <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ audit.description }}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                class="p-1.5 rounded text-gray-500 hover:text-white hover:bg-neutral-700 transition-colors"
                title="Configure"
                @click="openAuditConfig(audit)"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                :disabled="runningAudits.has(audit.name)"
                class="px-2.5 py-1 text-xs rounded bg-cyan-600/80 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                @click="runAudit(audit.name)"
              >
                <span v-if="runningAudits.has(audit.name)" class="flex items-center gap-1">
                  <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                  Running
                </span>
                <span v-else>Run</span>
              </button>
            </div>
          </div>

          <div class="mt-2 pt-2 border-t border-neutral-700/50">
            <span v-if="audit.latestRun" class="text-xs text-gray-500">Last run {{ formatRelativeDate(audit.latestRun.createdAt) }}</span>
            <span v-else class="text-xs text-gray-600">Never run</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Auto Checks Sub-tabs -->
    <div v-if="sourceFilter === 'AUTO'" class="inline-flex rounded-lg border border-neutral-700 overflow-hidden mb-4">
      <button
        class="px-4 py-2 text-sm"
        :class="autoSubTab === 'results' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="autoSubTab = 'results'"
      >
        Results
      </button>
      <button
        class="px-4 py-2 text-sm border-l border-neutral-700"
        :class="autoSubTab === 'runHistory' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="autoSubTab = 'runHistory'; fetchRuns()"
      >
        Run History
      </button>
    </div>

    <!-- Batch Actions Bar -->
    <div
      v-if="selectedGroupIndices.size > 0"
      class="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg border border-neutral-600 bg-neutral-800/80"
    >
      <span class="text-sm text-white font-medium">{{ selectedGroupIndices.size }} group(s) selected</span>
      <div class="flex gap-1.5 ml-2">
        <button :disabled="isBatchUpdating" class="px-2.5 py-1 text-xs rounded bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/50 disabled:opacity-50" @click="batchUpdate('OPEN')">Open</button>
        <button :disabled="isBatchUpdating" class="px-2.5 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50 disabled:opacity-50" @click="batchUpdate('PROCESSING')">Processing</button>
        <button :disabled="isBatchUpdating" class="px-2.5 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50 disabled:opacity-50" @click="batchUpdate('FIXED')">Fixed</button>
        <button :disabled="isBatchUpdating" class="px-2.5 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50 disabled:opacity-50" @click="batchUpdate('DISMISSED')">Dismiss</button>
        <button :disabled="isBatchUpdating" class="px-2.5 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50 disabled:opacity-50" @click="batchDelete">Delete</button>
      </div>
      <button class="ml-auto text-xs text-gray-500 hover:text-white" @click="selectedGroupIndices = new Set()">Clear</button>
    </div>

    <!-- Bulk Actions -->
    <div class="flex justify-end gap-2 mb-3">
      <button
        :disabled="isBulkDismissing || groups.length === 0"
        class="px-3 py-1.5 text-xs rounded-lg border border-neutral-600 text-neutral-400 hover:text-white hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed"
        @click="showDismissConfirm = true"
      >
        <span v-if="isBulkDismissing" class="flex items-center gap-1.5">
          <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
          Dismissing all...
        </span>
        <span v-else>Dismiss All Matching</span>
      </button>
      <button
        :disabled="isBulkDeleting || groups.length === 0"
        class="px-3 py-1.5 text-xs rounded-lg border border-red-800 text-red-400 hover:text-red-300 hover:border-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
        @click="showDeleteConfirm = true"
      >
        <span v-if="isBulkDeleting" class="flex items-center gap-1.5">
          <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
          Deleting all...
        </span>
        <span v-else>Delete All Matching</span>
      </button>
    </div>

    <!-- Report Groups Table -->
    <template v-if="sourceFilter !== 'AUTO' || autoSubTab === 'results'">
      <div class="overflow-x-auto rounded-lg border border-neutral-700">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
            <tr>
              <th class="px-3 py-3 w-8">
                <input type="checkbox" :checked="allVisibleSelected" class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer" @change="toggleSelectAll" />
              </th>
              <th class="px-3 py-3 w-8" />
              <th class="px-3 py-3">{{ t('reports.table.type') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.target') }}</th>
              <th class="px-3 py-3">{{ t('reports.admin.count') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.status') }}</th>
              <th class="px-3 py-3">Reported</th>
              <th class="px-3 py-3">Updated</th>
              <th class="px-3 py-3">{{ t('reports.admin.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(group, idx) in groups" :key="idx">
              <tr
                class="border-b border-neutral-700 hover:bg-neutral-800/50 cursor-pointer"
                data-testid="report-row"
                @click="toggleExpand(idx)"
              >
                <td class="px-3 py-3 w-8" @click.stop>
                  <input type="checkbox" :checked="selectedGroupIndices.has(idx)" class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer" @change="toggleSelectGroup(idx)" />
                </td>
                <td class="px-3 py-3 w-8 text-neutral-500">
                  <span class="inline-block transition-transform" :class="expandedGroups.has(idx) ? 'rotate-90' : ''">&#9654;</span>
                </td>
                <td class="px-3 py-3">
                  <span
                    class="px-2 py-1 text-xs font-medium rounded border"
                    :class="group.target.type === 'SEGMENT' ? 'bg-purple-500/20 text-purple-400 border-purple-600' : group.target.type === 'EPISODE' ? 'bg-amber-500/20 text-amber-400 border-amber-600' : 'bg-teal-500/20 text-teal-400 border-teal-600'"
                  >
                    {{ group.target.type }}
                  </span>
                </td>
                <td class="px-3 py-3 text-xs max-w-[250px]" :title="group.mediaName || group.target.mediaId">
                  <template v-if="group.target.mediaId">
                    <NuxtLink
                      :to="`/media/${group.target.mediaId}`"
                      class="block truncate font-medium text-white hover:text-purple-300 underline"
                      @click.stop
                    >
                      {{ group.mediaName || group.target.mediaId }}
                    </NuxtLink>
                    <span v-if="group.target.episodeNumber" class="text-neutral-400">EP{{ group.target.episodeNumber }}</span>
                    <NuxtLink
                      v-if="group.target.type === 'SEGMENT' && group.target.segmentId"
                      :to="`/sentence/${group.target.segmentId}`"
                      class="block text-purple-400 hover:text-purple-300 underline truncate"
                      :title="group.target.segmentId"
                      @click.stop
                    >
                      {{ group.target.segmentId }}
                    </NuxtLink>
                  </template>
                  <span v-else class="text-red-400 italic">deleted</span>
                </td>
                <td class="px-3 py-3 text-center">
                  <span class="px-2 py-1 text-xs font-bold rounded bg-neutral-700 text-white">{{ group.reportCount }}</span>
                  <span
                    v-if="group.reporterCount > 0"
                    class="block text-[10px] text-neutral-500 mt-0.5 cursor-help"
                    :title="[...new Set(group.reports.map(r => r.reporterName))].join(', ')"
                  >
                    {{ group.reporterCount }} {{ group.reporterCount === 1 ? 'reporter' : 'reporters' }}
                  </span>
                </td>
                <td class="px-3 py-3">
                  <span class="px-2 py-1 text-xs font-medium rounded border" :class="statusClass(group.status)">{{ group.status }}</span>
                </td>
                <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap" :title="formatDate(group.firstReportedAt)">
                  {{ formatRelativeDate(group.firstReportedAt) }}
                </td>
                <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap" :title="group.lastStatusChange ? formatDate(group.lastStatusChange) : ''">
                  {{ group.lastStatusChange ? formatRelativeDate(group.lastStatusChange) : '-' }}
                </td>
                <td class="px-3 py-3" @click.stop>
                  <div class="flex gap-1 flex-wrap">
                    <button class="px-2 py-1 text-xs rounded bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/50" @click="updateReport(group.reports[0].id, 'OPEN')">Open</button>
                    <button class="px-2 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50" @click="updateReport(group.reports[0].id, 'PROCESSING')">Processing</button>
                    <button class="px-2 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50" @click="updateReport(group.reports[0].id, 'FIXED')">Fixed</button>
                    <button class="px-2 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50" @click="updateReport(group.reports[0].id, 'DISMISSED')">Dismiss</button>
                    <button class="px-2 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50" @click="confirmDeleteReport(group.reports[0].id)">Delete</button>
                  </div>
                </td>
              </tr>

              <tr v-if="expandedGroups.has(idx)" v-for="report in group.reports" :key="report.id" class="bg-neutral-900/50 border-b border-neutral-800">
                <td colspan="2" />
                <td colspan="2" class="px-3 py-2 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 text-[10px] font-medium rounded border" :class="sourceClass(report.source)">{{ report.source }}</span>
                    <span class="font-medium text-neutral-300">{{ report.reason.replace(/_/g, ' ') }}</span>
                  </div>
                  <span v-if="report.description" class="block text-neutral-500 truncate max-w-[300px] mt-0.5" :title="report.description">{{ report.description }}</span>
                </td>
                <td class="px-3 py-2 text-xs text-neutral-300">{{ report.reporterName }}</td>
                <td />
                <td class="px-3 py-2 text-xs text-gray-500" :title="formatDate(report.createdAt)">{{ formatRelativeDate(report.createdAt) }}</td>
                <td class="px-3 py-2 max-w-[150px]">
                  <template v-if="editingNotes[report.id] !== undefined">
                    <input
                      v-model="editingNotes[report.id]"
                      class="w-full rounded border border-neutral-600 bg-neutral-800 text-white px-2 py-1 text-xs"
                      @keyup.enter="saveNotes(report.id)"
                      @keyup.escape="delete editingNotes[report.id]"
                    />
                    <button class="text-xs text-blue-400 hover:text-blue-300 mt-1" @click="saveNotes(report.id)">{{ t('reports.admin.save') }}</button>
                  </template>
                  <template v-else>
                    <span class="text-xs cursor-pointer hover:text-white truncate block max-w-[130px]" :title="report.adminNotes || ''" @click="startEditNotes(report)">
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
          @click="fetchReports(true)"
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

    <!-- Run History (Auto tab) -->
    <template v-if="sourceFilter === 'AUTO' && autoSubTab === 'runHistory'">
      <div class="overflow-x-auto rounded-lg border border-neutral-700">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
            <tr>
              <th class="px-3 py-3">Check</th>
              <th class="px-3 py-3">Category</th>
              <th class="px-3 py-3">Findings</th>
              <th class="px-3 py-3">Date</th>
              <th class="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in runs"
              :key="run.id"
              class="border-b border-neutral-700 hover:bg-neutral-800/50"
            >
              <td class="px-3 py-3 text-sm font-medium text-white">{{ run.auditName }}</td>
              <td class="px-3 py-3 text-xs text-gray-400">{{ run.category || 'All' }}</td>
              <td class="px-3 py-3">
                <span class="px-2 py-1 text-xs font-bold rounded bg-neutral-700 text-white">
                  {{ run.resultCount }}
                </span>
              </td>
              <td class="px-3 py-3 text-xs text-gray-400">{{ formatDate(run.createdAt) }}</td>
              <td class="px-3 py-3">
                <button
                  class="text-xs text-cyan-400 hover:text-cyan-300"
                  @click="autoSubTab = 'results'; activeStatuses = new Set(ALL_STATUSES); cursor = null; fetchReports()"
                >
                  View Results
                </button>
              </td>
            </tr>
            <tr v-if="runs.length === 0">
              <td colspan="5" class="px-4 py-8 text-center text-gray-500">No runs yet</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Audit Config Modal -->
    <Teleport to="body">
      <div
        v-if="showAuditConfig && editingAudit"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="showAuditConfig = false"
      >
        <div class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md">
          <h3 class="text-lg font-bold text-white mb-4">{{ editingAudit.label }}</h3>
          <p class="text-sm text-gray-400 mb-4">{{ editingAudit.description }}</p>

          <div class="space-y-3">
            <div v-for="field in editingAudit.thresholdSchema" :key="field.key" class="flex items-center gap-3">
              <label class="text-sm text-gray-300 flex-1">{{ field.label }}</label>
              <input
                v-if="field.type === 'number'"
                v-model.number="editThreshold[field.key]"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.key.includes('Ratio') ? 0.05 : 1"
                class="w-24 rounded border border-neutral-600 bg-neutral-800 text-white px-2 py-1 text-sm"
              />
              <input
                v-else
                v-model="editThreshold[field.key]"
                type="checkbox"
                class="rounded border-neutral-600"
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button
              class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600"
              @click="showAuditConfig = false"
            >
              Cancel
            </button>
            <button
              class="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-500"
              @click="saveAuditConfig"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <ConfirmModal
      :visible="showDismissConfirm"
      title="Dismiss all matching reports?"
      confirm-label="Dismiss All"
      @confirm="bulkDismissAllMatching"
      @cancel="showDismissConfirm = false"
    >
      This will dismiss <strong>all</strong> reports matching the current filters. This action can be undone by reopening individual reports.
    </ConfirmModal>

    <ConfirmModal
      :visible="showDeleteConfirm"
      title="Delete all matching reports?"
      confirm-label="Delete All"
      @confirm="bulkDeleteAllMatching"
      @cancel="showDeleteConfirm = false"
    >
      This will <strong>permanently delete</strong> all reports matching the current filters. This cannot be undone.
    </ConfirmModal>

    <ConfirmModal
      :visible="pendingDeleteId !== null"
      title="Delete this report group?"
      description="This will permanently delete this report and all duplicates with the same target and reason."
      confirm-label="Delete"
      @confirm="deleteReport"
      @cancel="cancelDeleteReport"
    />
  </div>
</template>
