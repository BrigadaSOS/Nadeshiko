<script setup lang="ts">
import { getRequestHeader } from 'h3';
import { authApiRequest } from '~/utils/authApi';

const { t } = useI18n();

type Report = {
  id: number;
  source: 'USER' | 'AUTO';
  target:
    | {
        type: 'SEGMENT';
        mediaId: number;
        episodeNumber?: number;
        segmentUuid: string;
      }
    | {
        type: 'EPISODE';
        mediaId: number;
        episodeNumber: number;
      }
    | {
        type: 'MEDIA';
        mediaId: number;
      };
  reviewCheckRunId?: number | null;
  reason: string;
  description?: string | null;
  data?: Record<string, unknown> | null;
  status: 'PENDING' | 'CONCERN' | 'ACCEPTED' | 'REJECTED' | 'RESOLVED' | 'IGNORED';
  adminNotes?: string | null;
  userId?: number | null;
  createdAt: string;
};

type AdminReport = Report & {
  reportCount: number;
  reporterName: string;
};

type ReviewCheck = {
  id: number;
  name: string;
  label: string;
  description: string;
  targetType: 'MEDIA' | 'EPISODE';
  threshold: Record<string, number | boolean>;
  enabled: boolean;
  thresholdSchema: Array<{
    key: string;
    label: string;
    type: 'number' | 'boolean';
    default: number | boolean;
    min?: number;
    max?: number;
  }>;
  latestRun?: { id: number; resultCount: number; createdAt: string } | null;
};

type ReviewCheckRun = {
  id: number;
  checkName: string;
  category?: string | null;
  resultCount: number;
  thresholdUsed: Record<string, number | boolean>;
  createdAt: string;
};

type AllowlistEntry = {
  id: number;
  checkName: string;
  mediaId: number;
  episodeNumber?: number | null;
  reason?: string | null;
  createdAt: string;
};

type ReportListResponse = {
  reports: AdminReport[];
  pagination: {
    hasMore: boolean;
    cursor: number | null;
  };
};

// State
const reports = ref<AdminReport[]>([]);
const isLoading = ref(false);
const hasMore = ref(false);
const cursor = ref<number | null>(null);

// Filters
const sourceFilter = ref<'' | 'USER' | 'AUTO'>('');
const statusFilter = ref('');

// Auto-check state
const checks = ref<ReviewCheck[]>([]);
const runningChecks = ref<Set<string>>(new Set());
const runs = ref<ReviewCheckRun[]>([]);
const allowlist = ref<AllowlistEntry[]>([]);

// Sub-tabs for Auto Checks view
const autoSubTab = ref<'results' | 'runHistory' | 'allowlist'>('results');

// Modals
const showCheckConfig = ref(false);
const editingCheck = ref<ReviewCheck | null>(null);
const editThreshold = ref<Record<string, number | boolean>>({});

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

const requestWithAuth = async <T>(
  path: string,
  fallback: T,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> => {
  if (import.meta.server) {
    const ctx = getServerRequestContext();
    if (!ctx || !ctx.baseUrl) return fallback;
    return await $fetch<T>(`${ctx.baseUrl}${path}`, {
      headers: ctx.headers,
      method: options?.method,
      body: options?.body,
    }).catch(() => fallback);
  }

  const response = await authApiRequest<T>(path, {
    method: options?.method,
    body: options?.body,
  });
  return response.ok && response.data ? response.data : fallback;
};

const buildReportPath = (append = false) => {
  const params = new URLSearchParams();
  if (cursor.value && append) params.set('cursor', String(cursor.value));
  if (statusFilter.value) params.set('status', statusFilter.value);
  if (sourceFilter.value) params.set('source', sourceFilter.value);
  params.set('limit', '20');
  return `/v1/admin/reports?${params.toString()}`;
};

const fetchReports = async (append = false) => {
  isLoading.value = true;
  try {
    const result = await requestWithAuth<ReportListResponse>(buildReportPath(append), {
      reports: [],
      pagination: { hasMore: false, cursor: null },
    });

    if (append) {
      reports.value.push(...result.reports);
    } else {
      reports.value = result.reports;
    }
    hasMore.value = result.pagination.hasMore;
    cursor.value = result.pagination.cursor;
  } finally {
    isLoading.value = false;
  }
};

const fetchChecks = async () => {
  checks.value = await requestWithAuth<ReviewCheck[]>('/v1/admin/review/checks', []);
};

const fetchRuns = async () => {
  const response = await authApiRequest<{ runs: ReviewCheckRun[]; hasMore: boolean }>('/v1/admin/review/runs?limit=50');
  if (response.ok && response.data) {
    runs.value = response.data.runs;
  }
};

const fetchAllowlist = async () => {
  const response = await authApiRequest<AllowlistEntry[]>('/v1/admin/review/allowlist');
  if (response.ok && response.data) {
    allowlist.value = response.data;
  }
};

const { data: initialAdminData } = await useAsyncData(
  'settings-admin-reports-initial',
  async () => {
    const [initialReports, initialChecks] = await Promise.all([
      requestWithAuth<ReportListResponse>(buildReportPath(false), {
        reports: [],
        pagination: { hasMore: false, cursor: null },
      }),
      requestWithAuth<ReviewCheck[]>('/v1/admin/review/checks', []),
    ]);

    return {
      reports: initialReports.reports,
      hasMore: initialReports.pagination.hasMore,
      cursor: initialReports.pagination.cursor,
      checks: initialChecks,
    };
  },
  {
    default: () => ({
      reports: [] as AdminReport[],
      hasMore: false,
      cursor: null as number | null,
      checks: [] as ReviewCheck[],
    }),
  },
);

reports.value = initialAdminData.value.reports;
hasMore.value = initialAdminData.value.hasMore;
cursor.value = initialAdminData.value.cursor;
checks.value = initialAdminData.value.checks;

watch([sourceFilter, statusFilter], () => {
  cursor.value = null;
  if (sourceFilter.value !== 'AUTO') {
    autoSubTab.value = 'results';
  }
  fetchReports();
});

const runCheck = async (checkName: string) => {
  runningChecks.value.add(checkName);
  try {
    const response = await authApiRequest<{ totalReports: number }>(`/v1/admin/review/run?checkName=${checkName}`, {
      method: 'POST',
    });
    if (response.ok && response.data) {
      useToastSuccess(`${checkName}: ${response.data.totalReports} findings`);
      await fetchReports();
      await fetchChecks();
    }
  } finally {
    runningChecks.value.delete(checkName);
  }
};

const updateReport = async (reportId: number, status: string, adminNotes?: string) => {
  const body: Record<string, string> = { status };
  if (adminNotes !== undefined) body.adminNotes = adminNotes;

  const response = await authApiRequest(`/v1/admin/reports/${reportId}`, {
    method: 'PATCH',
    body,
  });

  if (response.ok) {
    const idx = reports.value.findIndex((r) => r.id === reportId);
    if (idx !== -1) {
      const report = reports.value[idx];
      if (!report) return;
      report.status = status as AdminReport['status'];
      if (adminNotes !== undefined) report.adminNotes = adminNotes;
    }
    useToastSuccess(t('reports.admin.updateSuccess'));
  }
};

const openCheckConfig = (check: ReviewCheck) => {
  editingCheck.value = check;
  editThreshold.value = { ...check.threshold };
  showCheckConfig.value = true;
};

const saveCheckConfig = async () => {
  if (!editingCheck.value) return;

  const response = await authApiRequest(`/v1/admin/review/checks/${editingCheck.value.name}`, {
    method: 'PATCH',
    body: {
      threshold: editThreshold.value,
      enabled: editingCheck.value.enabled,
    },
  });

  if (response.ok) {
    useToastSuccess('Check config updated');
    showCheckConfig.value = false;
    await fetchChecks();
  }
};

const addToAllowlist = async (report: AdminReport) => {
  const checkName = reasonToCheckName(report.reason);
  if (!checkName) return;

  const episodeNumber = 'episodeNumber' in report.target ? report.target.episodeNumber : undefined;

  const response = await authApiRequest('/v1/admin/review/allowlist', {
    method: 'POST',
    body: {
      checkName,
      mediaId: report.target.mediaId,
      episodeNumber,
      reason: 'Allowlisted from admin panel',
    },
  });

  if (response.ok) {
    useToastSuccess('Added to allowlist');
  }
};

const removeAllowlistEntry = async (id: number) => {
  const response = await authApiRequest(`/v1/admin/review/allowlist/${id}`, {
    method: 'DELETE',
  });

  if (response.ok) {
    allowlist.value = allowlist.value.filter((e) => e.id !== id);
    useToastSuccess('Removed from allowlist');
  }
};

const reasonToCheckName = (reason: string): string | null => {
  const map: Record<string, string> = {
    LOW_SEGMENT_MEDIA: 'lowSegmentMedia',
    EMPTY_EPISODES: 'emptyEpisodes',
    MISSING_EPISODES_AUTO: 'missingEpisodes',
    BAD_SEGMENT_RATIO: 'badSegmentRatio',
    MEDIA_WITH_NO_EPISODES: 'mediaWithNoEpisodes',
    MISSING_TRANSLATIONS: 'missingTranslations',
    DB_ES_SYNC_ISSUES: 'dbEsSyncIssues',
    HIGH_REPORT_DENSITY: 'highReportDensity',
  };
  return map[reason] ?? null;
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

const getTrendArrow = (report: AdminReport): string | null => {
  if (report.source !== 'AUTO' || !report.data) return null;
  const prev = report.data.previousData as Record<string, unknown> | undefined;
  if (!prev) return 'NEW';
  const currentData = report.data as Record<string, unknown>;

  const keys = Object.keys(currentData).filter(
    (k) => k !== 'previousData' && k !== 'userReportCount' && typeof currentData[k] === 'number',
  );
  if (keys.length === 0) return null;

  const key = keys[0];
  if (!key) return null;
  const current = currentData[key] as number;
  const previous = prev[key] as number;
  if (current > previous) return 'UP';
  if (current < previous) return 'DOWN';
  return 'SAME';
};

const formatDate = (iso: string) => {
  return new Date(iso).toLocaleString();
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('reports.admin.title') }}</h1>
    </div>

    <!-- Source Tabs + Filters -->
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

      <select
        v-model="statusFilter"
        class="rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm"
      >
        <option value="">{{ t('reports.allStatuses') }}</option>
        <option value="PENDING">{{ t('reports.statuses.PENDING') }}</option>
        <option value="CONCERN">Concern</option>
        <option value="ACCEPTED">{{ t('reports.statuses.ACCEPTED') }}</option>
        <option value="REJECTED">{{ t('reports.statuses.REJECTED') }}</option>
        <option value="RESOLVED">{{ t('reports.statuses.RESOLVED') }}</option>
        <option value="IGNORED">Ignored</option>
      </select>

    </div>

    <!-- Check Cards (Auto tab) -->
    <div v-if="sourceFilter === 'AUTO' && checks.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      <div
        v-for="check in checks"
        :key="check.name"
        class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-3"
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium text-white">{{ check.label }}</span>
          <div class="flex items-center gap-2">
            <button
              class="text-gray-400 hover:text-white text-xs"
              title="Configure"
              @click="openCheckConfig(check)"
            >
              Settings
            </button>
            <button
              :disabled="runningChecks.has(check.name) || !check.enabled"
              class="px-2.5 py-1 text-xs rounded bg-button-danger-main text-white hover:bg-button-danger-hover disabled:opacity-40"
              @click="runCheck(check.name)"
            >
              {{ runningChecks.has(check.name) ? 'Running...' : 'Run' }}
            </button>
          </div>
        </div>
        <p class="text-xs text-gray-500 mb-2">{{ check.description }}</p>
        <div class="flex items-center gap-2">
          <span
            class="text-xs px-1.5 py-0.5 rounded"
            :class="check.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
          >
            {{ check.enabled ? 'ON' : 'OFF' }}
          </span>
          <span v-if="check.latestRun" class="text-xs text-gray-400">
            {{ check.latestRun.resultCount }} findings
          </span>
          <span v-else class="text-xs text-gray-500">No runs</span>
          <span v-if="check.latestRun" class="text-[10px] text-gray-500">
            &middot; {{ formatDate(check.latestRun.createdAt) }}
          </span>
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
      <button
        class="px-4 py-2 text-sm border-l border-neutral-700"
        :class="autoSubTab === 'allowlist' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="autoSubTab = 'allowlist'; fetchAllowlist()"
      >
        Allowlist
      </button>
    </div>

    <!-- Reports Table (shown when not on Auto sub-tabs, or on Auto "Results" sub-tab) -->
    <template v-if="sourceFilter !== 'AUTO' || autoSubTab === 'results'">
      <div class="overflow-x-auto rounded-lg border border-neutral-700">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
            <tr>
              <th class="px-3 py-3">ID</th>
              <th class="px-3 py-3">Source</th>
              <th class="px-3 py-3">{{ t('reports.table.type') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.target') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.reason') }}</th>
              <th class="px-3 py-3">{{ t('reports.table.description') }}</th>
              <th v-if="sourceFilter !== 'AUTO'" class="px-3 py-3">{{ t('reports.admin.reporter') }}</th>
              <th class="px-3 py-3">{{ t('reports.admin.count') }}</th>
              <th v-if="sourceFilter !== 'USER'" class="px-3 py-3">Trend</th>
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
                  :to="`/sentence/${report.target.segmentUuid}`"
                  class="block text-purple-400 hover:text-purple-300 underline truncate"
                >
                  {{ report.target.segmentUuid }}
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
              <td v-if="sourceFilter !== 'USER'" class="px-3 py-3 text-center">
                <template v-if="report.source === 'AUTO'">
                  <span v-if="getTrendArrow(report) === 'NEW'" class="text-xs font-bold text-green-400">NEW</span>
                  <span v-else-if="getTrendArrow(report) === 'UP'" class="text-red-400">&#9650;</span>
                  <span v-else-if="getTrendArrow(report) === 'DOWN'" class="text-green-400">&#9660;</span>
                  <span v-else-if="getTrendArrow(report) === 'SAME'" class="text-gray-500">&#8212;</span>
                  <span v-else class="text-gray-600">-</span>
                </template>
                <span v-else class="text-gray-600">-</span>
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
                  <button
                    v-if="report.source === 'AUTO'"
                    class="px-2 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50"
                    title="Add to allowlist"
                    @click="addToAllowlist(report)"
                  >
                    Allowlist
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

      <!-- Load More -->
      <div v-if="hasMore" class="mt-4 text-center">
        <button
          :disabled="isLoading"
          class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-50"
          @click="fetchReports(true)"
        >
          {{ isLoading ? t('reports.loading') : t('reports.loadMore') }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="isLoading && reports.length === 0" class="text-center py-8">
        <div
          class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full"
          role="status"
        />
      </div>
    </template>

    <!-- Run History (inline, Auto tab) -->
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
              <td class="px-3 py-3 text-sm font-medium text-white">{{ run.checkName }}</td>
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
                  @click="autoSubTab = 'results'; statusFilter = ''; cursor = null; fetchReports()"
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

    <!-- Allowlist (inline, Auto tab) -->
    <template v-if="sourceFilter === 'AUTO' && autoSubTab === 'allowlist'">
      <div class="overflow-x-auto rounded-lg border border-neutral-700">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
            <tr>
              <th class="px-3 py-3">Check</th>
              <th class="px-3 py-3">Media</th>
              <th class="px-3 py-3">Episode</th>
              <th class="px-3 py-3">Reason</th>
              <th class="px-3 py-3">Added</th>
              <th class="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in allowlist"
              :key="entry.id"
              class="border-b border-neutral-700 hover:bg-neutral-800/50"
            >
              <td class="px-3 py-3 text-sm font-medium text-white">{{ entry.checkName }}</td>
              <td class="px-3 py-3 font-mono text-xs">M{{ entry.mediaId }}</td>
              <td class="px-3 py-3 text-xs text-gray-400">{{ entry.episodeNumber ? `EP${entry.episodeNumber}` : '-' }}</td>
              <td class="px-3 py-3 text-xs text-gray-400 max-w-[200px] truncate">{{ entry.reason || '-' }}</td>
              <td class="px-3 py-3 text-xs text-gray-400">{{ formatDate(entry.createdAt) }}</td>
              <td class="px-3 py-3">
                <button
                  class="text-xs text-red-400 hover:text-red-300"
                  @click="removeAllowlistEntry(entry.id)"
                >
                  Remove
                </button>
              </td>
            </tr>
            <tr v-if="allowlist.length === 0">
              <td colspan="6" class="px-4 py-8 text-center text-gray-500">No allowlisted items</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Check Config Modal -->
    <Teleport to="body">
      <div
        v-if="showCheckConfig && editingCheck"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="showCheckConfig = false"
      >
        <div class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md">
          <h3 class="text-lg font-bold text-white mb-4">{{ editingCheck.label }}</h3>
          <p class="text-sm text-gray-400 mb-4">{{ editingCheck.description }}</p>

          <div class="space-y-3">
            <div v-for="field in editingCheck.thresholdSchema" :key="field.key" class="flex items-center gap-3">
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
            <input v-model="editingCheck.enabled" type="checkbox" class="rounded border-neutral-600" />
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button
              class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600"
              @click="showCheckConfig = false"
            >
              Cancel
            </button>
            <button
              class="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-500"
              @click="saveCheckConfig"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
