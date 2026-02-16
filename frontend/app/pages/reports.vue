<script setup lang="ts">
import { getRequestHeader } from 'h3';
import { authApiRequest } from '~/utils/authApi';

const { t } = useI18n();
definePageMeta({ middleware: 'auth' });

type Report = {
  id: number;
  target:
    | { type: 'SEGMENT'; mediaId: number; segmentUuid: string; episodeNumber?: number }
    | { type: 'EPISODE'; mediaId: number; episodeNumber: number }
    | { type: 'MEDIA'; mediaId: number };
  reason: string;
  description?: string | null;
  status: 'PENDING' | 'CONCERN' | 'ACCEPTED' | 'REJECTED' | 'RESOLVED' | 'IGNORED';
  createdAt: string;
};

const reports = ref<Report[]>([]);
const isLoading = ref(false);
const hasMore = ref(false);
const cursor = ref<number | null>(null);
const statusFilter = ref('');

type ReportListResponse = {
  reports: Report[];
  pagination: {
    hasMore: boolean;
    cursor: number | null;
  };
};

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
  params.set('limit', '20');
  return `/v1/user/reports?${params.toString()}`;
};

const fetchReports = async (append = false) => {
  isLoading.value = true;
  try {
    const result = await requestWithAuth<ReportListResponse>(buildReportPath(append), {
      reports: [],
      pagination: {
        hasMore: false,
        cursor: null,
      },
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

const { data: initialReportsData } = await useAsyncData(
  'user-reports-initial',
  async () => {
    const result = await requestWithAuth<ReportListResponse>(buildReportPath(false), {
      reports: [],
      pagination: {
        hasMore: false,
        cursor: null,
      },
    });
    return {
      reports: result.reports,
      hasMore: result.pagination.hasMore,
      cursor: result.pagination.cursor,
    };
  },
  {
    default: () => ({
      reports: [] as Report[],
      hasMore: false,
      cursor: null as number | null,
    }),
  },
);

reports.value = initialReportsData.value.reports;
hasMore.value = initialReportsData.value.hasMore;
cursor.value = initialReportsData.value.cursor;

watch(statusFilter, () => {
  cursor.value = null;
  fetchReports();
});

const statusClass = (status: string) => {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-600';
    case 'ACCEPTED':
      return 'bg-green-500/20 text-green-400 border-green-600';
    case 'REJECTED':
      return 'bg-red-500/20 text-red-400 border-red-600';
    case 'RESOLVED':
      return 'bg-blue-500/20 text-blue-400 border-blue-600';
    default:
      return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
  }
};
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold text-white mb-6">{{ t('reports.title') }}</h1>

    <!-- Filter -->
    <div class="mb-4">
      <select
        v-model="statusFilter"
        class="rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm"
      >
        <option value="">{{ t('reports.allStatuses') }}</option>
        <option value="PENDING">{{ t('reports.statuses.PENDING') }}</option>
        <option value="ACCEPTED">{{ t('reports.statuses.ACCEPTED') }}</option>
        <option value="REJECTED">{{ t('reports.statuses.REJECTED') }}</option>
        <option value="RESOLVED">{{ t('reports.statuses.RESOLVED') }}</option>
      </select>
    </div>

    <!-- Reports Table -->
    <div class="overflow-x-auto rounded-lg border border-neutral-700">
      <table class="w-full text-sm text-left text-gray-300">
        <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
          <tr>
            <th class="px-4 py-3">{{ t('reports.table.date') }}</th>
            <th class="px-4 py-3">{{ t('reports.table.type') }}</th>
            <th class="px-4 py-3">{{ t('reports.table.target') }}</th>
            <th class="px-4 py-3">{{ t('reports.table.reason') }}</th>
            <th class="px-4 py-3">{{ t('reports.table.status') }}</th>
            <th class="px-4 py-3">{{ t('reports.table.description') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="report in reports"
            :key="report.id"
            class="border-b border-neutral-700 hover:bg-neutral-800/50"
          >
            <td class="px-4 py-3 whitespace-nowrap">
              {{ new Date(report.createdAt).toLocaleDateString() }}
            </td>
            <td class="px-4 py-3">
              <span
                class="px-2 py-1 text-xs font-medium rounded border"
                :class="report.target.type === 'SEGMENT' ? 'bg-purple-500/20 text-purple-400 border-purple-600' : report.target.type === 'EPISODE' ? 'bg-amber-500/20 text-amber-400 border-amber-600' : 'bg-teal-500/20 text-teal-400 border-teal-600'"
              >
                {{ report.target.type }}
              </span>
            </td>
            <td class="px-4 py-3 font-mono text-xs max-w-[200px] truncate">
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
            <td class="px-4 py-3">
              {{ t(`reports.reasons.${report.reason}`) }}
            </td>
            <td class="px-4 py-3">
              <span
                class="px-2 py-1 text-xs font-medium rounded border"
                :class="statusClass(report.status)"
              >
                {{ t(`reports.statuses.${report.status}`) }}
              </span>
            </td>
            <td class="px-4 py-3 max-w-[250px] truncate">
              {{ report.description || '-' }}
            </td>
          </tr>
          <tr v-if="reports.length === 0 && !isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-gray-500">
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
  </div>
</template>
