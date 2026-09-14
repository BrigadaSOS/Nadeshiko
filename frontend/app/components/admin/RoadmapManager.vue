<script setup lang="ts">
import { mdiArrowDown, mdiArrowUp } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

type Kind = 'CONTENT' | 'FEATURE';
type Status = 'PROPOSED' | 'CONSIDERING' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
interface Item {
  id: string;
  kind: Kind;
  status: Status;
  title: string;
  description: string;
  sourceUrl: string | null;
  coverUrl: string | null;
  targetDate: string | null;
  introducedInVersion: string | null;
  sortOrder: number;
  proposerName: string | null;
  requesterUserId?: number | null;
}

const { t } = useI18n();
const items = ref<Item[]>([]);
const loading = ref(true);
const savingId = ref<string | null>(null);
const showNew = ref(false);
const activeKind = ref<Kind>('CONTENT');
const draft = reactive({
  kind: 'CONTENT' as Kind,
  status: 'PLANNED' as Exclude<Status, 'PROPOSED' | 'DECLINED'>,
  title: '',
  description: '',
  sourceUrl: '',
  coverUrl: '',
  targetDate: '',
  introducedInVersion: '',
  sortOrder: 0,
  proposerName: '',
});
const statuses: Status[] = ['PROPOSED', 'CONSIDERING', 'PLANNED', 'IN_PROGRESS', 'RELEASED', 'DECLINED'];
const statusOrder = new Map(statuses.map((status, index) => [status, index]));
const visibleItems = computed(() => {
  const matching = items.value.filter((item) => item.kind === activeKind.value);
  if (activeKind.value === 'CONTENT') {
    return matching.sort(
      (a, b) =>
        (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31') ||
        a.sortOrder - b.sortOrder ||
        a.title.localeCompare(b.title),
    );
  }
  return matching.sort(
    (a, b) =>
      (statusOrder.get(a.status) ?? 0) - (statusOrder.get(b.status) ?? 0) ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title),
  );
});

function selectKind(kind: Kind) {
  activeKind.value = kind;
  draft.kind = kind;
  draft.status = kind === 'CONTENT' ? 'PLANNED' : 'CONSIDERING';
  showNew.value = false;
}

function siblings(item: Item) {
  if (item.kind === 'CONTENT') {
    return visibleItems.value.filter(
      (candidate) => (candidate.targetDate?.slice(0, 7) ?? null) === (item.targetDate?.slice(0, 7) ?? null),
    );
  }
  return visibleItems.value.filter((candidate) => candidate.status === item.status);
}

function canMove(item: Item, offset: -1 | 1) {
  const group = siblings(item);
  const target = group.indexOf(item) + offset;
  return target >= 0 && target < group.length;
}

async function move(item: Item, offset: -1 | 1) {
  const group = siblings(item);
  const index = group.indexOf(item);
  const target = index + offset;
  if (target < 0 || target >= group.length) return;
  const current = group[index];
  const destination = group[target];
  if (!current || !destination) return;
  group[index] = destination;
  group[target] = current;
  group.forEach((candidate, position) => {
    candidate.sortOrder = (position + 1) * 10;
  });

  savingId.value = item.id;
  try {
    const updated = await Promise.all(
      group.map((candidate) =>
        $fetch<Item>(`/v1/admin/roadmap/${candidate.id}`, {
          method: 'PATCH',
          body: { sortOrder: candidate.sortOrder },
        }),
      ),
    );
    for (const saved of updated) {
      const existing = items.value.find((candidate) => candidate.id === saved.id);
      if (existing) Object.assign(existing, saved);
    }
  } catch (error) {
    handleApiError('admin.roadmap.reorder', error);
    await load();
  } finally {
    savingId.value = null;
  }
}

async function load() {
  loading.value = true;
  try {
    items.value = (await $fetch<{ items: Item[] }>('/v1/admin/roadmap')).items;
  } catch (error) {
    handleApiError('admin.roadmap.load', error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function save(item: Item) {
  savingId.value = item.id;
  try {
    const updated = await $fetch<Item>(`/v1/admin/roadmap/${item.id}`, {
      method: 'PATCH',
      body: {
        kind: item.kind,
        status: item.status,
        title: item.title,
        description: item.description,
        sourceUrl: item.sourceUrl || null,
        coverUrl: item.coverUrl || null,
        targetDate: item.targetDate || null,
        introducedInVersion: item.introducedInVersion || null,
        sortOrder: Number(item.sortOrder),
        proposerName: item.proposerName || null,
      },
    });
    Object.assign(item, updated);
  } catch (error) {
    handleApiError('admin.roadmap.save', error);
  } finally {
    savingId.value = null;
  }
}

async function create() {
  savingId.value = 'new';
  try {
    const item = await $fetch<Item>('/v1/admin/roadmap', {
      method: 'POST',
      body: {
        ...draft,
        sourceUrl: draft.sourceUrl || null,
        coverUrl: draft.coverUrl || null,
        targetDate: draft.targetDate || null,
        introducedInVersion: draft.introducedInVersion || null,
        sortOrder: Number(draft.sortOrder),
      },
    });
    items.value.push(item);
    Object.assign(draft, {
      kind: activeKind.value,
      status: activeKind.value === 'CONTENT' ? 'PLANNED' : 'CONSIDERING',
      title: '',
      description: '',
      sourceUrl: '',
      coverUrl: '',
      targetDate: '',
      introducedInVersion: '',
      sortOrder: 0,
      proposerName: '',
    });
    showNew.value = false;
  } catch (error) {
    handleApiError('admin.roadmap.create', error);
  } finally {
    savingId.value = null;
  }
}
</script>

<template>
  <div class="space-y-3 text-white">
    <div class="nd-settings-card space-y-5">
      <div class="flex items-center justify-between gap-4">
        <div><h1 class="nd-settings-title">{{ t('roadmap.admin.title') }}</h1><p class="mt-1 text-sm text-white/45">Approve proposals, publish roadmap entries, and set their order.</p></div>
        <button type="button" class="nd-btn-accent" @click="showNew = !showNew">Add {{ activeKind === 'CONTENT' ? 'title' : 'feature' }}</button>
      </div>
      <div class="flex border-b border-white/10" role="tablist" aria-label="Roadmap list">
        <button v-for="kind in (['CONTENT', 'FEATURE'] as const)" :key="kind" type="button" role="tab" :aria-selected="activeKind === kind"
          class="-mb-px border-b-2 px-4 py-2 text-sm" :class="activeKind === kind ? 'border-white text-white' : 'border-transparent text-white/45'"
          @click="selectKind(kind)">{{ kind === 'CONTENT' ? 'Titles' : 'Features' }}</button>
      </div>
    </div>

    <form v-if="showNew" class="nd-settings-card grid gap-3 md:grid-cols-2" @submit.prevent="create">
      <input v-model="draft.title" required maxlength="180" class="nd-input md:col-span-2" placeholder="Title">
      <select v-model="draft.status" class="nd-select"><option value="CONSIDERING">Considering</option><option value="PLANNED">Planned</option><option value="IN_PROGRESS">In progress</option><option value="RELEASED">Released</option></select>
      <textarea v-model="draft.description" maxlength="2000" class="nd-input md:col-span-2" rows="3" placeholder="Description" />
      <input v-model="draft.sourceUrl" type="url" class="nd-input" placeholder="Source URL">
      <input v-model="draft.coverUrl" type="url" class="nd-input" placeholder="Cover URL (automatic for AniList)">
      <input v-model="draft.targetDate" type="date" class="nd-input">
      <input v-if="activeKind === 'FEATURE'" v-model="draft.introducedInVersion" maxlength="32" class="nd-input" placeholder="Introduced in version (e.g. 2.4.19)">
      <input v-model.number="draft.sortOrder" type="number" class="nd-input" placeholder="Display order">
      <input v-if="activeKind === 'CONTENT'" v-model="draft.proposerName" maxlength="80" class="nd-input md:col-span-2" placeholder="Public Patreon credit (optional)">
      <button class="nd-btn-accent md:col-span-2" :disabled="savingId === 'new'">Create item</button>
    </form>

    <div v-if="loading" class="nd-settings-card flex justify-center"><span class="nd-spinner" /></div>
    <div v-else-if="!visibleItems.length" class="nd-settings-card text-center text-white/40">No {{ activeKind === 'CONTENT' ? 'titles' : 'features' }} yet.</div>
    <template v-else>
      <article v-for="item in visibleItems" :key="item.id" class="nd-settings-card">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2"><span class="text-xs font-semibold text-white/55">{{ item.status.replace('_', ' ') }}</span><span v-if="item.requesterUserId" class="text-xs text-white/35">Proposed by user #{{ item.requesterUserId }}</span></div>
          <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noopener" class="text-xs text-red-300 hover:text-red-200">Open submitted link ↗</a>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <input v-model="item.title" maxlength="180" class="nd-input md:col-span-2" aria-label="Title">
          <select v-model="item.status" class="nd-select md:col-span-2" aria-label="Status"><option v-for="status in statuses" :key="status" :value="status">{{ status.replace('_', ' ') }}</option></select>
          <textarea v-model="item.description" maxlength="2000" class="nd-input md:col-span-2" rows="2" aria-label="Description" />
          <input v-model="item.sourceUrl" type="url" class="nd-input" placeholder="Source URL" aria-label="Source URL">
          <input v-model="item.coverUrl" type="url" class="nd-input" placeholder="Cover URL (automatic for AniList)" aria-label="Cover URL">
          <input v-model="item.targetDate" type="date" class="nd-input" aria-label="Target date">
          <input v-if="item.kind === 'FEATURE'" v-model="item.introducedInVersion" maxlength="32" class="nd-input" placeholder="Introduced in version" aria-label="Introduced in version">
          <input v-model.number="item.sortOrder" type="number" class="nd-input" placeholder="Display order" aria-label="Display order">
          <input v-if="item.kind === 'CONTENT'" v-model="item.proposerName" maxlength="80" class="nd-input md:col-span-2" placeholder="Public Patreon credit (optional)" aria-label="Public Patreon credit">
        </div>
        <div class="mt-4 flex items-center justify-between gap-3">
          <div class="flex gap-2">
            <button type="button" class="nd-btn" :disabled="savingId !== null || !canMove(item, -1)" aria-label="Move up" @click="move(item, -1)"><UiBaseIcon :path="mdiArrowUp" size="18" /></button>
            <button type="button" class="nd-btn" :disabled="savingId !== null || !canMove(item, 1)" aria-label="Move down" @click="move(item, 1)"><UiBaseIcon :path="mdiArrowDown" size="18" /></button>
          </div>
          <button type="button" class="nd-btn-accent" :disabled="savingId === item.id" @click="save(item)">Save</button>
        </div>
      </article>
    </template>
  </div>
</template>
