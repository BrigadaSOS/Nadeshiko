<script setup lang="ts">
import type {
  BulkDeleteReportsRequest,
  BulkUpdateReportsRequest,
  ReportStatus,
  UpdateReportRequest,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { ALL_STATUSES, type ReportGroup } from './reports/reportHelpers';

const { t } = useI18n();
const { formatNumber } = useFormat();
const sdk = useNadeshikoSdk();

const groups = ref<ReportGroup[]>([]);
const {
  hasMore,
  loading: isReloading,
  loadingMore,
  load: loadFirstPage,
  loadMore: fetchNextPage,
} = useCursorPagination();
const isLoading = computed(() => isReloading.value || loadingMore.value);

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

const buildReportQuery = (cursor: string | null) => {
  const query: Record<string, string | number | boolean> = { take: 20 };
  if (cursor) query.cursor = cursor;
  if (statusFilterQuery.value) query.status = statusFilterQuery.value;
  if (sourceFilter.value) query.source = sourceFilter.value;
  if (orphanedFilter.value) query.orphaned = true;
  return query;
};

const fetchReportPage = async (cursor: string | null) => {
  try {
    const result = await sdk.listAdminReports(buildReportQuery(cursor));
    return {
      groups: result.groups,
      hasMore: result.pagination?.hasMore ?? false,
      cursor: result.pagination?.cursor ?? null,
    };
  } catch (err) {
    handleApiError('reports.fetchReports', err);
    return null;
  }
};

/** Reloads the first page for the active filters, dropping any page still in flight. */
const fetchReports = async () => {
  const outcome = await loadFirstPage(fetchReportPage);
  if (outcome.status !== 'ok') return;
  groups.value = outcome.page.groups;
};

const loadMoreReports = async () => {
  const outcome = await fetchNextPage(fetchReportPage);
  if (outcome.status !== 'ok') return;
  groups.value.push(...outcome.page.groups);
};

// Admin pages require auth -- skip SSR data fetch, load client-side only
onMounted(() => {
  fetchReports();
});

watch([sourceFilter, statusFilterQuery, orphanedFilter], () => {
  selectedGroupIndices.value = new Set();
  expandedGroups.value = new Set();
  fetchReports();
});

const updateReport = async (reportId: number, status?: string, adminNotes?: string) => {
  const body: UpdateReportRequest = {};
  if (status !== undefined) body.status = status as UpdateReportRequest['status'];
  if (adminNotes !== undefined) body.adminNotes = adminNotes;

  try {
    await sdk.updateAdminReport({ reportId, ...body });
    await fetchReports();
    useToastSuccess(t('reports.admin.updateSuccess'));
  } catch (err) {
    handleApiError('reports.updateReport', err, { toastKey: 'reports.admin.updateError' });
  }
};

const saveNotes = async (reportId: number) => {
  const notes = editingNotes.value[reportId];
  delete editingNotes.value[reportId];
  await updateReport(reportId, undefined, notes);
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
    const data = await sdk.batchUpdateAdminReports({ ids, status: status as ReportStatus });
    selectedGroupIndices.value = new Set();
    useToastSuccess(t('reports.admin.batchUpdated', { count: formatNumber(data.count) }));
    await fetchReports();
  } catch (err) {
    handleApiError('reports.batchUpdate', err, { toastKey: 'reports.admin.batchUpdateError' });
  } finally {
    isBatchUpdating.value = false;
  }
};

const batchDelete = async () => {
  const ids = selectedGroupRepIds.value;
  if (ids.length === 0) return;

  isBatchUpdating.value = true;
  const results = await Promise.allSettled(ids.map((id) => sdk.deleteAdminReport({ reportId: id })));

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - succeeded;

  // The partial-failure toast below is the user-facing signal; report the
  // individual rejections so they reach the error pipeline too.
  for (const result of results) {
    if (result.status === 'rejected') handleApiError('reports.batchDelete', result.reason, { toastKey: false });
  }

  selectedGroupIndices.value = new Set();
  if (succeeded > 0) useToastSuccess(t('reports.admin.batchDeleted', { count: formatNumber(succeeded) }));
  if (failed > 0) useToastError(t('reports.admin.batchDeletePartialError', { count: formatNumber(failed) }));
  await fetchReports();
  isBatchUpdating.value = false;
};

const buildBulkFilters = (): BulkUpdateReportsRequest['filters'] => {
  const filters: BulkUpdateReportsRequest['filters'] = {};
  if (bulkStatusFilter.value) filters.status = bulkStatusFilter.value;
  if (sourceFilter.value) filters.source = sourceFilter.value;
  if (orphanedFilter.value) filters.orphaned = true;
  return Object.keys(filters).length > 0 ? filters : undefined;
};

const bulkDismissAllMatching = async () => {
  showDismissConfirm.value = false;
  isBulkDismissing.value = true;
  try {
    const data = await sdk.bulkUpdateAdminReports({
      status: 'DISMISSED',
      filters: buildBulkFilters(),
    });

    useToastSuccess(t('reports.admin.batchDismissed', { count: formatNumber(data.count) }));
    await fetchReports();
  } catch (err) {
    handleApiError('reports.bulkDismiss', err, { toastKey: 'reports.admin.batchDismissError' });
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
    await sdk.deleteAdminReport({ reportId });
    useToastSuccess(t('reports.admin.deleteSuccess'));
    await fetchReports();
  } catch (err) {
    handleApiError('reports.deleteReport', err, { toastKey: 'reports.admin.deleteError' });
  }
};

const bulkDeleteAllMatching = async () => {
  showDeleteConfirm.value = false;
  isBulkDeleting.value = true;
  try {
    const data = await sdk.bulkDeleteAdminReports({
      filters: buildBulkFilters() as BulkDeleteReportsRequest['filters'],
    });

    useToastSuccess(t('reports.admin.batchDeleted', { count: formatNumber(data.count) }));
    await fetchReports();
  } catch (err) {
    handleApiError('reports.bulkDelete', err, { toastKey: 'reports.admin.batchDeleteError' });
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

    <AdminReportsFilters
      v-model:source="sourceFilter"
      v-model:orphaned="orphanedFilter"
      :active-statuses="activeStatuses"
      @toggle-status="toggleStatus"
    />

    <!-- Batch Actions Bar -->
    <AdminReportsSelectionBar
      v-if="selectedGroupIndices.size > 0"
      :count="selectedGroupIndices.size"
      :is-updating="isBatchUpdating"
      @update="batchUpdate"
      @delete="batchDelete"
      @clear="selectedGroupIndices = new Set()"
    />

    <!-- Bulk Actions -->
    <AdminReportsBulkActions
      :is-dismissing="isBulkDismissing"
      :is-deleting="isBulkDeleting"
      :has-results="groups.length > 0"
      @dismiss-all="showDismissConfirm = true"
      @delete-all="showDeleteConfirm = true"
    />

    <!-- Report Groups Table -->
    <AdminReportsTable
      :groups="groups"
      :is-loading="isLoading"
      :has-more="hasMore"
      :expanded-groups="expandedGroups"
      :selected-indices="selectedGroupIndices"
      :editing-notes="editingNotes"
      @toggle-expand="toggleExpand"
      @toggle-select="toggleSelectGroup"
      @toggle-select-all="toggleSelectAll"
      @update-status="updateReport"
      @delete-report="confirmDeleteReport"
      @save-notes="saveNotes"
      @load-more="loadMoreReports"
    />

    <CommonConfirmModal
      :visible="showDismissConfirm"
      :title="t('reports.admin.confirm.dismissAllTitle')"
      :description="t('reports.admin.confirm.dismissAllDescription')"
      :confirm-label="t('reports.admin.confirm.dismissAllButton')"
      @confirm="bulkDismissAllMatching"
      @cancel="showDismissConfirm = false"
    />

    <CommonConfirmModal
      :visible="showDeleteConfirm"
      :title="t('reports.admin.confirm.deleteAllTitle')"
      :description="t('reports.admin.confirm.deleteAllDescription')"
      :confirm-label="t('reports.admin.confirm.deleteAllButton')"
      @confirm="bulkDeleteAllMatching"
      @cancel="showDeleteConfirm = false"
    />

    <CommonConfirmModal
      :visible="pendingDeleteId !== null"
      :title="t('reports.admin.confirm.deleteGroupTitle')"
      :description="t('reports.admin.confirm.deleteGroupDescription')"
      :confirm-label="t('reports.admin.delete')"
      @confirm="deleteReport"
      @cancel="cancelDeleteReport"
    />
  </div>
</template>
