<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import { buildSentencePath } from '~/utils/routes';

/**
 * What the moderation agent actually changed, read from the revisions it wrote
 * rather than from anything it reports about itself.
 *
 * The point of this screen is the spot check: with no moderators, nobody reviews
 * every agent edit, so the safeguard is sampling a few and being able to undo one
 * in a single click. That is why each row shows the before/after diff inline
 * instead of linking out — a screen that requires opening a tab per row does not
 * get used.
 */
const { t } = useI18n();
const { formatRelativeTime, formatDate } = useFormat();
const localePath = useLocalePath();
const sdk = useNadeshikoSdk();

type ActivityEntry = {
  revisionId: number;
  revisionNumber: number;
  segmentPublicId: string;
  mediaPublicId: string;
  episodeNumber: number;
  snapshot: Record<string, unknown>;
  current: Record<string, unknown>;
  reportId: number | null;
  actedBy: string | null;
  createdAt: string;
};

const entries = ref<ActivityEntry[]>([]);
const isLoading = ref(false);
const restoringId = ref<number | null>(null);
const windowDays = ref(1);

/** Only fields that actually moved — an edit touches one or two of eleven. */
const changedFields = (entry: ActivityEntry): { field: string; before: unknown; after: unknown }[] => {
  const fields = new Set([...Object.keys(entry.snapshot), ...Object.keys(entry.current)]);
  return [...fields]
    .map((field) => ({ field, before: entry.snapshot[field], after: entry.current[field] }))
    .filter(({ before, after }) => JSON.stringify(before) !== JSON.stringify(after));
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const fetchActivity = async () => {
  isLoading.value = true;
  try {
    const since = new Date(Date.now() - windowDays.value * 24 * 60 * 60 * 1000).toISOString();
    const data = await sdk.listAgentActivity({ since, take: 200 });
    entries.value = (data.entries ?? []) as ActivityEntry[];
  } catch (err) {
    handleApiError('agentActivity.fetch', err);
  } finally {
    isLoading.value = false;
  }
};

const restore = async (entry: ActivityEntry) => {
  restoringId.value = entry.revisionId;
  try {
    await sdk.restoreSegmentRevision({
      segmentPublicId: entry.segmentPublicId,
      revisionNumber: entry.revisionNumber,
    });
    useToastSuccess(t('agentActivity.restoreSuccess'));
    // Refetch rather than dropping the row: the restore writes a new revision,
    // and showing that is the honest view of what the table now contains.
    await fetchActivity();
  } catch (err) {
    handleApiError('agentActivity.restore', err, { toastKey: 'agentActivity.restoreError' });
  } finally {
    restoringId.value = null;
  }
};

onMounted(fetchActivity);
watch(windowDays, fetchActivity);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('agentActivity.title') }}</h1>
      <select
        v-model.number="windowDays"
        class="rounded-lg border border-neutral-600 bg-neutral-800 text-white px-3 py-2 text-sm"
      >
        <option :value="1">{{ t('agentActivity.window.day') }}</option>
        <option :value="7">{{ t('agentActivity.window.week') }}</option>
        <option :value="30">{{ t('agentActivity.window.month') }}</option>
      </select>
    </div>

    <p class="text-sm text-neutral-400 mb-4">{{ t('agentActivity.description') }}</p>

    <div class="overflow-x-auto rounded-lg border border-neutral-700">
      <table class="w-full text-sm text-left text-gray-300">
        <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
          <tr>
            <th class="px-3 py-3">{{ t('agentActivity.table.segment') }}</th>
            <th class="px-3 py-3">{{ t('agentActivity.table.change') }}</th>
            <th class="px-3 py-3">{{ t('agentActivity.table.report') }}</th>
            <th class="px-3 py-3">{{ t('agentActivity.table.when') }}</th>
            <th class="px-3 py-3">{{ t('agentActivity.table.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.revisionId" class="border-b border-neutral-700 align-top">
            <td class="px-3 py-3 text-xs whitespace-nowrap">
              <NuxtLink
                :to="localePath(buildSentencePath(entry.segmentPublicId))"
                class="text-purple-400 hover:text-purple-300 underline"
              >
                {{ entry.segmentPublicId }}
              </NuxtLink>
              <span class="block text-neutral-500">{{ t('agentActivity.episode', { number: entry.episodeNumber }) }}</span>
            </td>

            <td class="px-3 py-3 text-xs">
              <div v-for="change in changedFields(entry)" :key="change.field" class="mb-2 last:mb-0">
                <span class="text-neutral-400 font-medium">{{ change.field }}</span>
                <div class="mt-0.5">
                  <span class="text-red-300 line-through break-all">{{ displayValue(change.before) }}</span>
                  <span class="text-neutral-500 mx-1">&rarr;</span>
                  <span class="text-green-300 break-all">{{ displayValue(change.after) }}</span>
                </div>
              </div>
            </td>

            <td class="px-3 py-3 text-xs text-neutral-400">
              <span v-if="entry.reportId">#{{ entry.reportId }}</span>
              <span v-else class="italic">{{ t('agentActivity.noReport') }}</span>
            </td>

            <td class="px-3 py-3 text-xs text-gray-400 whitespace-nowrap" :title="formatDate(entry.createdAt, 'dateTime')">
              {{ formatRelativeTime(entry.createdAt) }}
            </td>

            <td class="px-3 py-3">
              <button
                :disabled="restoringId === entry.revisionId"
                class="px-2 py-1 text-xs rounded bg-amber-600/30 text-amber-300 hover:bg-amber-600/50 disabled:opacity-50 whitespace-nowrap"
                @click="restore(entry)"
              >
                {{ restoringId === entry.revisionId ? t('agentActivity.restoring') : t('agentActivity.restore') }}
              </button>
            </td>
          </tr>

          <tr v-if="entries.length === 0 && !isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-gray-500">{{ t('agentActivity.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isLoading" class="text-center py-8">
      <div
        class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full"
        role="status"
      />
    </div>
  </div>
</template>
