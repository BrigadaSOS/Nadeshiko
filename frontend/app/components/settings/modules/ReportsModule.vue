<script setup lang="ts">
import type {
  BulkDeleteReportsRequest,
  BulkUpdateReportsRequest,
  MediaAudit,
  MediaAuditRun,
  ReportStatus,
  UpdateReportRequest,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { ALL_STATUSES, formatNumber, type ReportGroup } from './reports/reportHelpers';

const { t, locale } = useI18n();
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
    const result = await sdk.listAdminReports(buildReportQuery(append));

    if (append) {
      groups.value.push(...result.groups);
    } else {
      groups.value = result.groups;
    }
    hasMore.value = result.pagination.hasMore;
    cursor.value = result.pagination.cursor;
  } catch (err) {
    handleApiError('reports.fetchReports', err);
  } finally {
    isLoading.value = false;
  }
};

const fetchAudits = async () => {
  const data = await sdk.listAdminMediaAudits().catch((err) => {
    // The audit cards are a secondary panel; an empty list is the inline state.
    handleApiError('reports.fetchAudits', err, { toastKey: false });
    return null;
  });
  audits.value = (Array.isArray(data) ? data : []) as MediaAudit[];
};

const fetchRuns = async () => {
  try {
    const data = await sdk.listAdminMediaAuditRuns({ take: 50 });
    runs.value = data.runs;
  } catch (err) {
    handleApiError('reports.fetchRuns', err, { toastKey: false });
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
    const data = await sdk.runAdminMediaAudit(auditName);
    useToastSuccess(
      t('reports.admin.auditRunResult', {
        audit: auditName,
        count: formatNumber(data.totalReports ?? 0, locale.value),
      }),
    );
    await fetchReports();
    await fetchAudits();
  } catch (err) {
    handleApiError('reports.runAudit', err);
  } finally {
    runningAudits.value.delete(auditName);
  }
};

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

const openAuditConfig = (audit: MediaAudit) => {
  editingAudit.value = audit;
  editThreshold.value = { ...audit.threshold } as Record<string, number | boolean>;
  showAuditConfig.value = true;
};

const saveAuditConfig = async () => {
  if (!editingAudit.value) return;

  try {
    await sdk.updateAdminMediaAudit({
      name: editingAudit.value.name,
      threshold: editThreshold.value,
    });
    useToastSuccess(t('reports.admin.auditConfigUpdated'));
    showAuditConfig.value = false;
    await fetchAudits();
  } catch (err) {
    handleApiError('reports.saveAuditConfig', err);
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
    useToastSuccess(t('reports.admin.batchUpdated', { count: formatNumber(data.count, locale.value) }));
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
  if (succeeded > 0) useToastSuccess(t('reports.admin.batchDeleted', { count: formatNumber(succeeded, locale.value) }));
  if (failed > 0)
    useToastError(t('reports.admin.batchDeletePartialError', { count: formatNumber(failed, locale.value) }));
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

    useToastSuccess(t('reports.admin.batchDismissed', { count: formatNumber(data.count, locale.value) }));
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

    useToastSuccess(t('reports.admin.batchDeleted', { count: formatNumber(data.count, locale.value) }));
    await fetchReports();
  } catch (err) {
    handleApiError('reports.bulkDelete', err, { toastKey: 'reports.admin.batchDeleteError' });
  } finally {
    isBulkDeleting.value = false;
  }
};

const viewRunResults = () => {
  autoSubTab.value = 'results';
  activeStatuses.value = new Set(ALL_STATUSES);
  cursor.value = null;
  fetchReports();
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white" data-testid="reports-title">{{ t('reports.admin.title') }}</h1>
    </div>

    <SettingsModulesReportsFilters
      v-model:source="sourceFilter"
      v-model:orphaned="orphanedFilter"
      :active-statuses="activeStatuses"
      @toggle-status="toggleStatus"
    />

    <!-- Audit Cards (Auto tab) -->
    <SettingsModulesReportsAuditCards
      v-if="sourceFilter === 'AUTO'"
      :audits="audits"
      :running-audits="runningAudits"
      @configure="openAuditConfig"
      @run="runAudit"
    />

    <!-- Auto Checks Sub-tabs -->
    <div v-if="sourceFilter === 'AUTO'" class="inline-flex rounded-lg border border-neutral-700 overflow-hidden mb-4">
      <button
        class="px-4 py-2 text-sm"
        :class="autoSubTab === 'results' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="autoSubTab = 'results'"
      >
        {{ t('reports.admin.resultsTab') }}
      </button>
      <button
        class="px-4 py-2 text-sm border-l border-neutral-700"
        :class="autoSubTab === 'runHistory' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="autoSubTab = 'runHistory'; fetchRuns()"
      >
        {{ t('reports.admin.runHistoryTab') }}
      </button>
    </div>

    <!-- Batch Actions Bar -->
    <SettingsModulesReportsSelectionBar
      v-if="selectedGroupIndices.size > 0"
      :count="selectedGroupIndices.size"
      :is-updating="isBatchUpdating"
      @update="batchUpdate"
      @delete="batchDelete"
      @clear="selectedGroupIndices = new Set()"
    />

    <!-- Bulk Actions -->
    <SettingsModulesReportsBulkActions
      :is-dismissing="isBulkDismissing"
      :is-deleting="isBulkDeleting"
      :has-results="groups.length > 0"
      @dismiss-all="showDismissConfirm = true"
      @delete-all="showDeleteConfirm = true"
    />

    <!-- Report Groups Table -->
    <SettingsModulesReportsTable
      v-if="sourceFilter !== 'AUTO' || autoSubTab === 'results'"
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
      @load-more="fetchReports(true)"
    />

    <!-- Run History (Auto tab) -->
    <SettingsModulesReportsRunHistory
      v-if="sourceFilter === 'AUTO' && autoSubTab === 'runHistory'"
      :runs="runs"
      @view-results="viewRunResults"
    />

    <SettingsModulesReportsAuditConfigModal
      :open="showAuditConfig"
      :audit="editingAudit"
      :threshold="editThreshold"
      @close="showAuditConfig = false"
      @save="saveAuditConfig"
    />

    <ConfirmModal
      :visible="showDismissConfirm"
      :title="t('reports.admin.confirm.dismissAllTitle')"
      :description="t('reports.admin.confirm.dismissAllDescription')"
      :confirm-label="t('reports.admin.confirm.dismissAllButton')"
      @confirm="bulkDismissAllMatching"
      @cancel="showDismissConfirm = false"
    />

    <ConfirmModal
      :visible="showDeleteConfirm"
      :title="t('reports.admin.confirm.deleteAllTitle')"
      :description="t('reports.admin.confirm.deleteAllDescription')"
      :confirm-label="t('reports.admin.confirm.deleteAllButton')"
      @confirm="bulkDeleteAllMatching"
      @cancel="showDeleteConfirm = false"
    />

    <ConfirmModal
      :visible="pendingDeleteId !== null"
      :title="t('reports.admin.confirm.deleteGroupTitle')"
      :description="t('reports.admin.confirm.deleteGroupDescription')"
      :confirm-label="t('reports.admin.delete')"
      @confirm="deleteReport"
      @cancel="cancelDeleteReport"
    />
  </div>
</template>
