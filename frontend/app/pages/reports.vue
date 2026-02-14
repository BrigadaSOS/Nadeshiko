<script setup lang="ts">
import { authApiRequest } from '~/utils/authApi';
import { userStore } from '~/stores/auth';

const { t } = useI18n();
const user = userStore();
const router = useRouter();

if (!user.isLoggedIn) {
  router.push('/');
}

type Report = {
  id: number;
  reportType: 'SEGMENT' | 'MEDIA';
  targetId: string;
  reason: string;
  description?: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'RESOLVED';
  createdAt: string;
};

const reports = ref<Report[]>([]);
const isLoading = ref(false);
const hasMore = ref(false);
const cursor = ref<number | null>(null);
const statusFilter = ref('');

const fetchReports = async (append = false) => {
  isLoading.value = true;
  try {
    const params = new URLSearchParams();
    if (cursor.value && append) params.set('cursor', String(cursor.value));
    if (statusFilter.value) params.set('status', statusFilter.value);
    params.set('size', '20');

    const response = await authApiRequest<{
      data: Report[];
      total: number;
      hasMore: boolean;
      cursor: number | null;
    }>(`/v1/user/reports?${params.toString()}`);

    if (response.ok && response.data) {
      if (append) {
        reports.value.push(...response.data.data);
      } else {
        reports.value = response.data.data;
      }
      hasMore.value = response.data.hasMore;
      cursor.value = response.data.cursor;
    }
  } finally {
    isLoading.value = false;
  }
};

watch(statusFilter, () => {
  cursor.value = null;
  fetchReports();
});

onMounted(() => fetchReports());

const statusClass = (status: string) => {
  switch (status) {
    case 'PENDING': return 'bg-yellow-500/20 text-yellow-400 border-yellow-600';
    case 'ACCEPTED': return 'bg-green-500/20 text-green-400 border-green-600';
    case 'REJECTED': return 'bg-red-500/20 text-red-400 border-red-600';
    case 'RESOLVED': return 'bg-blue-500/20 text-blue-400 border-blue-600';
    default: return 'bg-neutral-500/20 text-neutral-400 border-neutral-600';
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
                :class="report.reportType === 'SEGMENT' ? 'bg-purple-500/20 text-purple-400 border-purple-600' : 'bg-teal-500/20 text-teal-400 border-teal-600'"
              >
                {{ report.reportType }}
              </span>
            </td>
            <td class="px-4 py-3 font-mono text-xs max-w-[200px] truncate">
              {{ report.targetId }}
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
