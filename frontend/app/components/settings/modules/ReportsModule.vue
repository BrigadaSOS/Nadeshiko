<script setup lang="ts">
import type { AdminReport, MediaAudit, MediaAuditRun } from '@brigadasos/nadeshiko-sdk';

const { t } = useI18n();
const sdk = useNadeshikoSdk();

const reports = ref<AdminReport[]>([]);
const isLoading = ref(false);
const hasMore = ref(false);
const cursor = ref<string | null>(null);

const sourceFilter = ref<'' | 'USER' | 'AUTO'>('');

const ALL_STATUSES = ['PENDING', 'CONCERN', 'ACCEPTED', 'REJECTED', 'RESOLVED', 'IGNORED'] as const;
const activeStatuses = ref(new Set<string>(ALL_STATUSES));

const statusFilterQuery = computed(() => {
  if (activeStatuses.value.size === 0 || activeStatuses.value.size === ALL_STATUSES.length) return '';
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
  const query: Record<string, string | number> = { take: 20 };
  if (cursor.value && append) query.cursor = cursor.value;
  if (statusFilterQuery.value) query.status = statusFilterQuery.value;
  if (sourceFilter.value) query.source = sourceFilter.value;
  return query;
};

const fetchReports = async (append = false) => {
  isLoading.value = true;
  try {
    const { data } = await sdk.listAdminReports({ query: buildReportQuery(append) });
    const result = data ?? { reports: [], pagination: { hasMore: false, cursor: null } };

    if (append) {
      reports.value.push(...(result.reports as AdminReport[]));
    } else {
      reports.value = (result.reports ?? []) as AdminReport[];
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
    runs.value = ((data as any)?.runs ?? []) as MediaAuditRun[];
  } catch {}
};

const { data: initialAdminData } = await useAsyncData(
  'settings-admin-reports-initial',
  async () => {
    const [reportsResult, auditsResult] = await Promise.all([
      sdk.listAdminReports({ query: buildReportQuery(false) }).catch(() => ({ data: null })),
      sdk.listAdminMediaAudits().catch(() => ({ data: null })),
    ]);

    const reportData = reportsResult.data;
    return {
      reports: (reportData?.reports ?? []) as AdminReport[],
      hasMore: reportData?.pagination?.hasMore ?? false,
      cursor: reportData?.pagination?.cursor ?? null,
      audits: (Array.isArray(auditsResult.data) ? auditsResult.data : []) as MediaAudit[],
    };
  },
  {
    default: () => ({
      reports: [] as AdminReport[],
      hasMore: false,
      cursor: null as string | null,
      audits: [] as MediaAudit[],
    }),
  },
);

reports.value = initialAdminData.value.reports;
hasMore.value = initialAdminData.value.hasMore;
cursor.value = initialAdminData.value.cursor;
audits.value = initialAdminData.value.audits;

watch([sourceFilter, statusFilterQuery], () => {
  cursor.value = null;
  autoSubTab.value = 'results';
  selectedIds.value = new Set();
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

const runAllAudits = async () => {
  const enabled = audits.value.filter((a) => a.enabled);
  for (const audit of enabled) {
    await runAudit(audit.name);
  }
};

const updateReport = async (reportId: number, status: AdminReport['status'], adminNotes?: string) => {
  try {
    await sdk.updateAdminReport({
      path: { id: reportId },
      body: {
        status,
        ...(adminNotes !== undefined ? { adminNotes } : {}),
      },
    });

    const idx = reports.value.findIndex((r) => r.id === reportId);
    if (idx !== -1) {
      const report = reports.value[idx];
      if (!report) return;
      report.status = status as AdminReport['status'];
      if (adminNotes !== undefined) report.adminNotes = adminNotes;
    }
    useToastSuccess(t('reports.admin.updateSuccess'));
  } catch {}
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
        enabled: editingAudit.value.enabled,
      },
    });
    useToastSuccess('Audit config updated');
    showAuditConfig.value = false;
    await fetchAudits();
  } catch {}
};

const statusClass = (status: string) => {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-600';
    case 'CONCERN':
      return 'bg-orange-500/20 text-orange-400 border-orange-600';
    case 'ACCEPTED':
      return 'bg-green-500/20 text-green-400 border-green-600';
    case 'REJECTED':
      return 'bg-red-500/20 text-red-400 border-red-600';
    case 'RESOLVED':
      return 'bg-blue-500/20 text-blue-400 border-blue-600';
    case 'IGNORED':
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

const editingNotes = ref<Record<number, string>>({});

const startEditNotes = (report: AdminReport) => {
  editingNotes.value[report.id] = report.adminNotes || '';
};

const saveNotes = (reportId: number) => {
  const report = reports.value.find((r) => r.id === reportId);
  if (!report) return;
  updateReport(reportId, report.status, editingNotes.value[reportId]);
  delete editingNotes.value[reportId];
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

const isRunningAny = computed(() => runningAudits.value.size > 0);

const selectedIds = ref(new Set<number>());
const isBatchUpdating = ref(false);

const allVisibleSelected = computed(() => {
  return reports.value.length > 0 && reports.value.every((r) => selectedIds.value.has(r.id));
});

const toggleSelectAll = () => {
  if (allVisibleSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(reports.value.map((r) => r.id));
  }
};

const toggleSelect = (id: number) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
};

const batchUpdate = async (status: AdminReport['status']) => {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;

  isBatchUpdating.value = true;
  try {
    await sdk.batchUpdateAdminReports({ body: { ids, status } });
    for (const report of reports.value) {
      if (selectedIds.value.has(report.id)) {
        report.status = status;
      }
    }
    selectedIds.value = new Set();
    useToastSuccess(`${ids.length} report(s) updated`);
  } catch {
  } finally {
    isBatchUpdating.value = false;
  }
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('reports.admin.title') }}</h1>
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
    </div>

    <!-- Audit Cards (Auto tab) -->
    <div v-if="sourceFilter === 'AUTO'" class="mb-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm text-gray-400">Available checks</span>
        <button
          :disabled="isRunningAny || audits.filter(a => a.enabled).length === 0"
          class="px-3 py-1.5 text-xs rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
          @click="runAllAudits"
        >
          {{ isRunningAny ? 'Running...' : 'Run All' }}
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div
          v-for="audit in audits"
          :key="audit.name"
          class="rounded-lg border bg-neutral-800/50 p-4 transition-colors"
          :class="audit.enabled ? 'border-neutral-700' : 'border-neutral-800 opacity-60'"
        >
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-white truncate">{{ audit.label }}</span>
                <span
                  class="shrink-0 w-1.5 h-1.5 rounded-full"
                  :class="audit.enabled ? 'bg-green-400' : 'bg-neutral-600'"
                />
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
                :disabled="runningAudits.has(audit.name) || !audit.enabled"
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

          <div v-if="audit.latestRun" class="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-700/50">
            <span class="text-xs text-gray-400">
              <span class="font-mono font-medium text-white">{{ audit.latestRun.resultCount }}</span> findings
            </span>
            <span class="text-neutral-600">&middot;</span>
            <span class="text-xs text-gray-500">{{ formatRelativeDate(audit.latestRun.createdAt) }}</span>
          </div>
          <div v-else class="mt-2 pt-2 border-t border-neutral-700/50">
            <span class="text-xs text-gray-600">Never run</span>
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
      v-if="selectedIds.size > 0"
      class="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg border border-neutral-600 bg-neutral-800/80"
    >
      <span class="text-sm text-white font-medium">{{ selectedIds.size }} selected</span>
      <div class="flex gap-1.5 ml-2">
        <button
          :disabled="isBatchUpdating"
          class="px-2.5 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50 disabled:opacity-50"
          @click="batchUpdate('ACCEPTED')"
        >
          Accept
        </button>
        <button
          :disabled="isBatchUpdating"
          class="px-2.5 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50 disabled:opacity-50"
          @click="batchUpdate('REJECTED')"
        >
          Reject
        </button>
        <button
          :disabled="isBatchUpdating"
          class="px-2.5 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50 disabled:opacity-50"
          @click="batchUpdate('RESOLVED')"
        >
          Resolve
        </button>
        <button
          :disabled="isBatchUpdating"
          class="px-2.5 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50 disabled:opacity-50"
          @click="batchUpdate('IGNORED')"
        >
          Ignore
        </button>
      </div>
      <button
        class="ml-auto text-xs text-gray-500 hover:text-white"
        @click="selectedIds = new Set()"
      >
        Clear
      </button>
    </div>

    <!-- Reports Table -->
    <template v-if="sourceFilter !== 'AUTO' || autoSubTab === 'results'">
      <div class="overflow-x-auto rounded-lg border border-neutral-700">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
            <tr>
              <th class="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="px-3 py-3">ID</th>
              <th class="px-3 py-3">Source</th>
              <th class="px-3 py-3">{{ t('reports.table.type') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.target') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.reason') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.description') }}</th>
              <th v-if="sourceFilter !== 'AUTO'" class="px-3 py-3">{{ t('reports.admin.reporter') }}</th>
              <th class="px-3 py-3">{{ t('reports.admin.count') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.status') }}</th>
              <th class="px-3 py-3">{{ t('reports.admin.notes') }}</th>
              <th class="px-3 py-3">{{ t('reports.admin.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="report in reports"
              :key="report.id"
              class="border-b border-neutral-700 hover:bg-neutral-800/50"
            >
              <td class="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(report.id)"
                  class="rounded border-neutral-600 bg-neutral-800 text-blue-500 cursor-pointer"
                  @change="toggleSelect(report.id)"
                />
              </td>
              <td class="px-3 py-3">{{ report.id }}</td>
              <td class="px-3 py-3">
                <span
                  class="px-2 py-1 text-xs font-medium rounded border"
                  :class="sourceClass(report.source)"
                >
                  {{ report.source }}
                </span>
              </td>
              <td class="px-3 py-3">
                <span
                  class="px-2 py-1 text-xs font-medium rounded border"
                  :class="report.target.type === 'SEGMENT' ? 'bg-purple-500/20 text-purple-400 border-purple-600' : report.target.type === 'EPISODE' ? 'bg-amber-500/20 text-amber-400 border-amber-600' : 'bg-teal-500/20 text-teal-400 border-teal-600'"
                >
                  {{ report.target.type }}
                </span>
              </td>
              <td class="px-3 py-3 font-mono text-xs max-w-[150px] truncate">
                <span>M{{ report.target.mediaId }}</span>
                <span v-if="'episodeNumber' in report.target && report.target.episodeNumber"> EP{{ report.target.episodeNumber }}</span>
                <NuxtLink
                  v-if="report.target.type === 'SEGMENT'"
                  :to="`/sentence/${report.target.segmentId}`"
                  class="block text-purple-400 hover:text-purple-300 underline truncate"
                >
                  {{ report.target.segmentId }}
                </NuxtLink>
              </td>
              <td class="px-3 py-3 text-xs">
                {{ report.reason.replace(/_/g, ' ') }}
              </td>
              <td class="px-3 py-3 max-w-[200px] truncate text-xs">
                {{ report.description || '-' }}
              </td>
              <td v-if="sourceFilter !== 'AUTO'" class="px-3 py-3 text-xs">
                {{ report.reporterName }}
              </td>
              <td class="px-3 py-3 text-center">
                <span class="px-2 py-1 text-xs font-bold rounded bg-neutral-700 text-white">
                  {{ report.reportCount }}
                </span>
                <span
                  v-if="report.source === 'AUTO' && report.data?.userReportCount"
                  class="block text-[10px] text-yellow-400 mt-0.5"
                >
                  +{{ report.data.userReportCount }} user
                </span>
              </td>
              <td class="px-3 py-3">
                <span
                  class="px-2 py-1 text-xs font-medium rounded border"
                  :class="statusClass(report.status)"
                >
                  {{ report.status }}
                </span>
              </td>
              <td class="px-3 py-3 max-w-[200px]">
                <template v-if="editingNotes[report.id] !== undefined">
                  <input
                    v-model="editingNotes[report.id]"
                    class="w-full rounded border border-neutral-600 bg-neutral-800 text-white px-2 py-1 text-xs"
                    @keyup.enter="saveNotes(report.id)"
                  />
                  <button
                    class="text-xs text-blue-400 hover:text-blue-300 mt-1"
                    @click="saveNotes(report.id)"
                  >
                    {{ t('reports.admin.save') }}
                  </button>
                </template>
                <template v-else>
                  <span class="text-xs cursor-pointer hover:text-white" @click="startEditNotes(report)">
                    {{ report.adminNotes || t('reports.admin.addNote') }}
                  </span>
                </template>
              </td>
              <td class="px-3 py-3">
                <div class="flex gap-1 flex-wrap">
                  <button
                    v-if="report.status === 'PENDING'"
                    class="px-2 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50"
                    @click="updateReport(report.id, 'ACCEPTED')"
                  >
                    {{ t('reports.admin.accept') }}
                  </button>
                  <button
                    v-if="report.status === 'PENDING'"
                    class="px-2 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50"
                    @click="updateReport(report.id, 'REJECTED')"
                  >
                    {{ t('reports.admin.reject') }}
                  </button>
                  <button
                    v-if="report.status !== 'RESOLVED' && report.status !== 'IGNORED'"
                    class="px-2 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50"
                    @click="updateReport(report.id, 'RESOLVED')"
                  >
                    {{ t('reports.admin.resolve') }}
                  </button>
                  <button
                    v-if="report.source === 'AUTO' && report.status !== 'IGNORED'"
                    class="px-2 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50"
                    @click="updateReport(report.id, 'IGNORED')"
                  >
                    Ignore
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="reports.length === 0 && !isLoading">
              <td colspan="12" class="px-4 py-8 text-center text-gray-500">
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

      <div v-if="isLoading && reports.length === 0" class="text-center py-8">
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

          <div class="flex items-center gap-3 mt-4">
            <label class="text-sm text-gray-300">Enabled</label>
            <input v-model="editingAudit.enabled" type="checkbox" class="rounded border-neutral-600" />
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
  </div>
</template>
