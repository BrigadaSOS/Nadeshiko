<script setup lang="ts">
import {
  mdiArrowRight,
  mdiBookOpenPageVariantOutline,
  mdiCardsOutline,
  mdiCardTextOutline,
  mdiCheck,
  mdiFilterOutline,
  mdiHistory,
  mdiKeyOutline,
  mdiMapOutline,
  mdiMovieOpenOutline,
  mdiPatreon,
  mdiTools,
  mdiTranslate,
  mdiYoutube,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

type Status = 'PROPOSED' | 'CONSIDERING' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
interface RoadmapItem {
  id: string;
  kind: 'CONTENT' | 'FEATURE';
  status: Status;
  title: string;
  description: string;
  sourceUrl: string | null;
  coverUrl: string | null;
  targetDate: string | null;
  introducedInVersion: string | null;
  sortOrder: number;
  createdAt: string;
  proposerName: string | null;
}
interface PatreonConnection {
  linked: true;
  fullName: string | null;
  active: boolean;
  patronStatus: string | null;
  entitledAmountCents: number;
}
type ProposalState = 'anonymous' | 'unlinked' | 'inactive' | 'active' | 'submitted';

const { t } = useI18n();
const user = userStore();
const { openLoginModal } = useLoginModal();

useSeoMeta({
  title: () => t('roadmap.seoTitle'),
  description: () => t('roadmap.seoDescription'),
  ogTitle: () => t('roadmap.seoTitle'),
  ogDescription: () => t('roadmap.seoDescription'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
});

const { data, error, refresh } = await useAsyncData('roadmap', () =>
  $fetch<{ items: RoadmapItem[]; patreonUrl: string }>('/v1/roadmap'),
);
const items = computed(() => data.value?.items ?? []);
const patreonUrl = computed(() => data.value?.patreonUrl ?? 'https://www.patreon.com/c/BrigadaSOS');
const connection = ref<PatreonConnection | null>(null);
const connectionLoading = ref(false);
const connectionLoaded = ref(false);
const working = ref(false);
const submitted = ref(false);
const sourceUrl = ref('');
const proposalTitle = ref('');
const proposalNote = ref('');
const proposerName = ref('');
const selectedKind = ref<'CONTENT' | 'FEATURE'>('CONTENT');
const PATREON_PROPOSALS_ENABLED = false;
const isDev = import.meta.dev;
const devProposalState = ref<'auto' | ProposalState>('auto');
const isDevPreview = computed(() => isDev && devProposalState.value !== 'auto');
const proposalState = computed<ProposalState | 'loading'>(() => {
  if (isDevPreview.value) return devProposalState.value as ProposalState;
  if (!user.isLoggedIn) return 'anonymous';
  if (connectionLoading.value) return 'loading';
  if (!connection.value) return 'unlinked';
  if (!connection.value.active) return 'inactive';
  if (submitted.value) return 'submitted';
  return 'active';
});

const titleItems = computed(() =>
  items.value
    .filter((item) => item.kind === 'CONTENT')
    .sort((a, b) => {
      const aDone = a.status === 'RELEASED';
      const bDone = b.status === 'RELEASED';
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (aDone) return (b.targetDate ?? '').localeCompare(a.targetDate ?? '') || a.sortOrder - b.sortOrder;
      return (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31') || a.sortOrder - b.sortOrder;
    }),
);

const featureItems = computed(() =>
  items.value
    .filter(
      (item) => item.kind === 'FEATURE' && (PATREON_PROPOSALS_ENABLED || item.title !== 'Patreon title proposals'),
    )
    .sort((a, b) => {
      const aReleased = a.status === 'RELEASED';
      const bReleased = b.status === 'RELEASED';
      if (aReleased !== bReleased) return aReleased ? 1 : -1;
      if (!aReleased) return a.sortOrder - b.sortOrder;
      return (b.targetDate ?? '').localeCompare(a.targetDate ?? '') || a.sortOrder - b.sortOrder;
    }),
);

const featureIcons: Record<string, string> = {
  'Patreon title proposals': mdiPatreon,
  'Better search filters': mdiFilterOutline,
  'Public roadmap': mdiMapOutline,
  'Seven interface languages': mdiTranslate,
  'YouTube playback in search': mdiYoutube,
  'Word cards': mdiCardTextOutline,
  'Your own dictionaries': mdiBookOpenPageVariantOutline,
  'Rich Anki mining': mdiCardsOutline,
  'Search history and familiar titles': mdiHistory,
  'Granular API keys': mdiKeyOutline,
};

const featureTranslationKeys: Record<string, string> = {
  'Patreon title proposals': 'patreonProposals',
  'Better search filters': 'searchFilters',
  'Public roadmap': 'publicRoadmap',
  'Seven interface languages': 'interfaceLanguages',
  'YouTube playback in search': 'youtubePlayback',
  'Word cards': 'wordCards',
  'Your own dictionaries': 'ownDictionaries',
  'Rich Anki mining': 'ankiMining',
  'Search history and familiar titles': 'searchHistory',
  'Granular API keys': 'apiKeys',
};

function featureIcon(item: RoadmapItem) {
  return featureIcons[item.title] ?? mdiTools;
}

function featureTitle(item: RoadmapItem) {
  const key = featureTranslationKeys[item.title];
  return key ? t(`roadmap.features.${key}.title`) : item.title;
}

function featureDescription(item: RoadmapItem) {
  const key = featureTranslationKeys[item.title];
  return key ? t(`roadmap.features.${key}.description`) : item.description;
}

async function loadConnection(force = false) {
  if (!user.isLoggedIn || (connectionLoaded.value && !force)) return;
  connectionLoading.value = true;
  try {
    const response = await $fetch<{ connection: PatreonConnection | null }>('/v1/user/connections/patreon');
    connection.value = response.connection;
    connectionLoaded.value = true;
  } catch (caught) {
    handleApiError('roadmap.patreon.load', caught, { toastKey: false });
  } finally {
    connectionLoading.value = false;
  }
}

onMounted(loadConnection);
watch(
  () => user.isLoggedIn,
  (signedIn) => signedIn && loadConnection(true),
);

async function connectPatreon() {
  if (isDevPreview.value) {
    devProposalState.value = 'active';
    return;
  }
  working.value = true;
  try {
    const response = await $fetch<{ authorizeUrl: string }>('/v1/user/connections/patreon', { method: 'POST' });
    window.location.href = response.authorizeUrl;
  } catch (caught) {
    handleApiError('roadmap.patreon.connect', caught);
    working.value = false;
  }
}

async function submitProposal() {
  if (isDevPreview.value) {
    devProposalState.value = 'submitted';
    return;
  }
  working.value = true;
  try {
    await $fetch('/v1/roadmap/proposals', {
      method: 'POST',
      body: {
        sourceUrl: sourceUrl.value,
        title: proposalTitle.value || undefined,
        note: proposalNote.value || undefined,
        proposerName: proposerName.value || undefined,
      },
    });
    submitted.value = true;
    sourceUrl.value = '';
    proposalTitle.value = '';
    proposalNote.value = '';
    proposerName.value = '';
    await refresh();
  } catch (caught) {
    handleApiError('roadmap.proposal.submit', caught);
  } finally {
    working.value = false;
  }
}

function signInForProposal() {
  if (isDevPreview.value) {
    devProposalState.value = 'unlinked';
    return;
  }
  openLoginModal('roadmap_proposal');
}

function checkMembership() {
  if (isDevPreview.value) {
    devProposalState.value = 'active';
    return;
  }
  loadConnection(true);
}

function submitAnother() {
  if (isDevPreview.value) devProposalState.value = 'active';
  else submitted.value = false;
}

function scrollToProposal() {
  document.getElementById('propose')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatMonth(month: string) {
  if (month === 'unscheduled') return t('roadmap.dateFlexible');
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

function featureDate(item: RoadmapItem) {
  if (item.status !== 'RELEASED') return t('roadmap.featureSoon');
  if (!item.targetDate) return t('roadmap.featureReleased');
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${item.targetDate}T00:00:00Z`));
}
</script>

<template>
  <div class="roadmap-page -mt-3 pb-16 text-white">
    <section class="roadmap-banner relative flex min-h-[20rem] items-center overflow-hidden border-b border-white/10 bg-[var(--background)] px-4 py-14 md:min-h-[21rem] md:py-16">
      <div class="roadmap-banner-image absolute inset-0" aria-hidden="true" />
      <div class="nd-page relative">
        <h1 class="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight md:text-5xl">
          {{ t('roadmap.title') }}
        </h1>
        <p class="mt-6 max-w-2xl text-base leading-relaxed text-white/65 md:text-lg">{{ t('roadmap.intro') }}</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <a :href="patreonUrl" target="_blank" rel="noopener" class="inline-flex h-11 items-center gap-2 rounded-lg bg-[#ff424d] px-5 font-semibold text-white hover:bg-[#ff5962]">
            <UiBaseIcon :path="mdiPatreon" size="19" /> {{ t('roadmap.support') }}
          </a>
          <a v-if="PATREON_PROPOSALS_ENABLED" href="#propose" class="nd-btn h-11 px-5" @click.prevent="scrollToProposal">{{ t('roadmap.proposeCta') }}</a>
        </div>
      </div>
    </section>

    <main class="nd-page px-4 md:px-0">
      <section class="py-8 md:py-10" :aria-label="t('roadmap.filterLabel')">
        <div id="features" class="mb-8 flex justify-center gap-6 border-b border-white/10" role="tablist" :aria-label="t('roadmap.filterLabel')">
            <button v-for="kind in (['CONTENT', 'FEATURE'] as const)" :key="kind" type="button" role="tab" :aria-selected="selectedKind === kind"
              class="-mb-px inline-flex items-center gap-2.5 border-b-2 px-6 py-3 text-lg font-bold transition" :class="selectedKind === kind ? 'border-white text-white' : 'border-transparent text-white/45 hover:text-white'"
              @click="selectedKind = kind"><UiBaseIcon :path="kind === 'CONTENT' ? mdiMovieOpenOutline : mdiTools" size="22" />{{ t(`roadmap.filters.${kind.toLowerCase()}`) }}</button>
        </div>

        <div v-if="error" class="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">{{ t('roadmap.loadError') }}</div>
        <ol v-else-if="selectedKind === 'CONTENT'" class="roadmap-timeline relative mx-auto max-w-4xl">
          <li v-for="item in titleItems" :key="item.id" class="roadmap-timeline-item relative grid gap-3 pb-8 pl-8 md:grid-cols-[10rem_2rem_1fr] md:gap-x-3 md:gap-y-0 md:pl-0">
            <span class="roadmap-timeline-dot absolute left-0 top-0 z-10 flex size-5 items-center justify-center overflow-hidden rounded-full border-[3px] md:left-[11.125rem] md:top-[calc(50%-1rem)] md:-translate-y-1/2" :class="item.status === 'RELEASED' ? 'border-transparent bg-[#8a8a8a] text-[var(--background)]' : 'border-[var(--accent)] bg-[var(--background)]'">
              <UiBaseIcon v-if="item.status === 'RELEASED'" :path="mdiCheck" w="w-3" h="h-3" size="12" />
            </span>
            <div class="flex self-stretch flex-col justify-center gap-1 whitespace-nowrap text-sm font-semibold md:translate-y-2.5 md:text-right" :class="item.status === 'RELEASED' ? 'text-white/45' : 'text-red-300'">
              <time>{{ formatMonth(item.targetDate?.slice(0, 7) ?? 'unscheduled') }}</time>
              <span class="text-xs">{{ item.status === 'RELEASED' ? t('roadmap.titleDone') : t('roadmap.titleInProgress') }}</span>
            </div>
            <span class="hidden md:block" aria-hidden="true" />
            <article class="grid grid-cols-[auto_1fr] items-start overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
              <div v-if="item.coverUrl" class="flex w-28 shrink-0 self-start items-start justify-center bg-[var(--background)] sm:w-32">
                <img :src="item.coverUrl" :alt="item.title" class="block h-auto max-h-none w-auto max-w-full object-contain object-top" loading="lazy">
              </div>
              <div v-else class="flex aspect-[46/65] w-28 items-center justify-center border-r border-[var(--line)] bg-[var(--surface-hover)] text-white/25 sm:w-32"><UiBaseIcon :path="mdiMovieOpenOutline" size="34" /></div>
              <div class="flex min-h-full min-w-0 flex-col p-5">
                <h2 class="text-xl font-bold leading-tight">{{ item.title }}</h2>
                <p class="mt-3 flex items-center gap-1.5 text-sm text-white/50"><UiBaseIcon :path="mdiPatreon" size="15" />{{ t('roadmap.proposedBy', { name: t('roadmap.patronCommunity') }) }}</p>
                <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" class="mt-auto inline-flex items-center gap-1 pt-4 text-xs font-semibold text-red-300 hover:text-red-200">
                  {{ t('roadmap.viewSource') }} <UiBaseIcon :path="mdiArrowRight" size="14" />
                </a>
              </div>
            </article>
          </li>
          <li v-if="!titleItems.length" class="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-white/35">{{ t('roadmap.emptyTitles') }}</li>
        </ol>
        <ol v-else class="roadmap-timeline relative mx-auto max-w-4xl">
          <li v-for="item in featureItems" :key="item.id" class="feature-roadmap-item relative grid gap-3 pb-8 pl-8 md:grid-cols-[10rem_2rem_1fr] md:gap-x-3 md:gap-y-0 md:pl-0">
            <span class="roadmap-timeline-dot absolute left-0 top-0 z-10 flex size-5 items-center justify-center overflow-hidden rounded-full border-[3px] md:left-[11.125rem] md:top-[calc(50%-1rem)] md:-translate-y-1/2" :class="item.status === 'RELEASED' ? 'border-transparent bg-[#8a8a8a] text-[var(--background)]' : 'border-[var(--accent)] bg-[var(--background)]'">
              <UiBaseIcon v-if="item.status === 'RELEASED'" :path="mdiCheck" w="w-3" h="h-3" size="12" />
            </span>
            <div class="flex self-stretch flex-col items-start justify-center text-sm font-semibold md:items-end md:text-right" :class="item.status === 'RELEASED' ? 'text-white/45' : 'text-red-300'">
              <time>{{ featureDate(item) }}</time>
              <span v-if="item.introducedInVersion" class="text-xs text-white/35">v{{ item.introducedInVersion }}</span>
            </div>
            <span class="hidden md:block" aria-hidden="true" />
            <article class="feature-roadmap-content relative">
              <h2 class="flex items-center gap-2 text-xl font-bold"><UiBaseIcon :path="featureIcon(item)" size="21" class="shrink-0 text-white/55" />{{ featureTitle(item) }}</h2>
              <p v-if="item.description" class="mt-2 max-w-2xl leading-relaxed text-white/55">{{ featureDescription(item) }}</p>
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" class="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-300 hover:text-red-200">{{ t('roadmap.viewSource') }} <UiBaseIcon :path="mdiArrowRight" size="14" /></a>
            </article>
          </li>
          <li v-if="!featureItems.length" class="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-white/35">{{ t('roadmap.emptyFeatures') }}</li>
        </ol>
      </section>

    </main>

    <section v-if="PATREON_PROPOSALS_ENABLED" id="propose" class="proposal-panel border-y border-white/10 px-4 py-14 md:py-20">
      <div class="nd-page">
        <header class="mx-auto max-w-2xl text-center">
          <h2 class="inline-flex items-center justify-center gap-3 text-3xl font-black underline decoration-[var(--accent)] decoration-4 underline-offset-8 md:text-4xl"><UiBaseIcon :path="mdiPatreon" size="32" class="text-[var(--accent)]" />{{ t('roadmap.proposalTitle') }}</h2>
          <p class="mt-4 leading-relaxed text-white/55">{{ t('roadmap.proposalIntro') }}</p>
        </header>

        <ol class="mx-auto mt-8 grid max-w-3xl gap-3 text-center text-sm sm:grid-cols-3">
          <li class="rounded-lg border border-[var(--line)] bg-[var(--background)] px-4 py-3"><span class="mr-2 font-bold text-[var(--accent-soft)]">1</span>{{ t('roadmap.steps.signIn') }}</li>
          <li class="rounded-lg border border-[var(--line)] bg-[var(--background)] px-4 py-3"><span class="mr-2 font-bold text-[var(--accent-soft)]">2</span>{{ t('roadmap.steps.patreon') }}</li>
          <li class="rounded-lg border border-[var(--line)] bg-[var(--background)] px-4 py-3"><span class="mr-2 font-bold text-[var(--accent-soft)]">3</span>{{ t('roadmap.steps.propose') }}</li>
        </ol>

        <label v-if="isDev" class="mx-auto mt-6 flex max-w-md items-center gap-3 rounded-lg border border-dashed border-[var(--accent-soft)] bg-[var(--surface)] px-4 py-3 text-xs text-white/55">
          <span class="shrink-0 font-semibold text-[var(--accent-soft)]">Local preview</span>
          <select v-model="devProposalState" class="nd-select min-w-0 flex-1" aria-label="Preview proposal state">
            <option value="auto">Actual account state</option>
            <option value="anonymous">Signed out</option>
            <option value="unlinked">Patreon not linked</option>
            <option value="inactive">No active membership</option>
            <option value="active">Active patron</option>
            <option value="submitted">Submitted</option>
          </select>
        </label>

        <div class="mx-auto mt-8 max-w-2xl px-5 md:px-8">
            <div v-if="proposalState === 'anonymous'" data-testid="roadmap-anonymous" class="py-5 text-center">
              <h3 class="text-lg font-bold">{{ t('roadmap.states.anonymousTitle') }}</h3>
              <p class="mt-2 text-sm text-white/50">{{ t('roadmap.states.anonymousBody') }}</p>
              <button type="button" class="nd-btn-accent mt-5" @click="signInForProposal">{{ t('roadmap.signIn') }}</button>
            </div>
            <div v-else-if="proposalState === 'loading'" class="flex justify-center py-10"><span class="nd-spinner" /></div>
            <div v-else-if="proposalState === 'unlinked'" data-testid="roadmap-unlinked" class="py-5 text-center">
              <h3 class="text-lg font-bold">{{ t('roadmap.states.unlinkedTitle') }}</h3>
              <p class="mt-2 text-sm text-white/50">{{ t('roadmap.states.unlinkedBody') }}</p>
              <div class="mt-5 flex flex-wrap justify-center gap-3">
                <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-[#ff424d] px-4 py-2 font-semibold text-white hover:bg-[#ff5962]" :disabled="working" @click="connectPatreon"><UiBaseIcon :path="mdiPatreon" size="18" />{{ t('roadmap.linkPatreon') }}</button>
                <a :href="patreonUrl" target="_blank" rel="noopener" class="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-4 py-2 font-semibold text-white/75 hover:bg-white/10 hover:text-white">{{ t('roadmap.becomePatron') }}</a>
              </div>
            </div>
            <div v-else-if="proposalState === 'inactive'" data-testid="roadmap-inactive" class="py-5 text-center">
              <h3 class="text-lg font-bold">{{ t('roadmap.states.inactiveTitle') }}</h3>
              <p class="mt-2 text-sm text-white/50">{{ t('roadmap.states.inactiveBody') }}</p>
              <div class="mt-5 flex flex-wrap justify-center gap-2">
                <a :href="patreonUrl" target="_blank" rel="noopener" class="inline-flex items-center gap-2 rounded-lg bg-[#ff424d] px-4 py-2 font-semibold text-white hover:bg-[#ff5962]"><UiBaseIcon :path="mdiPatreon" size="18" />{{ t('roadmap.becomePatron') }}</a>
                <button type="button" class="nd-btn" :disabled="connectionLoading" @click="checkMembership">{{ t('roadmap.checkAgain') }}</button>
              </div>
            </div>
            <div v-else-if="proposalState === 'submitted'" data-testid="roadmap-submitted" class="py-5 text-center">
              <div class="mx-auto flex size-11 items-center justify-center rounded-full bg-red-400/15 text-red-200"><UiBaseIcon :path="mdiCheck" /></div>
              <h3 class="mt-4 text-lg font-bold">{{ t('roadmap.states.submittedTitle') }}</h3>
              <p class="mt-2 text-sm text-white/50">{{ t('roadmap.states.submittedBody') }}</p>
              <button type="button" class="nd-btn mt-5" @click="submitAnother">{{ t('roadmap.submitAnother') }}</button>
            </div>
            <form v-else data-testid="roadmap-patron-form" class="space-y-4" @submit.prevent="submitProposal">
              <div class="mb-5 flex items-center justify-between gap-3">
                <div><p class="font-bold">{{ t('roadmap.states.activeTitle') }}</p><p class="text-xs text-white/40">{{ connection?.fullName || t('roadmap.patreonMember') }}</p></div>
                <span class="rounded-full bg-red-400/15 px-3 py-1 text-xs font-semibold text-red-200">{{ t('roadmap.activeBadge') }}</span>
              </div>
              <label class="block"><span class="mb-1.5 block text-sm text-white/65">{{ t('roadmap.form.url') }}</span><input v-model="sourceUrl" required type="url" class="nd-input w-full" :placeholder="t('roadmap.form.urlPlaceholder')"></label>
              <label class="block"><span class="mb-1.5 block text-sm text-white/65">{{ t('roadmap.form.title') }}</span><input v-model="proposalTitle" maxlength="180" class="nd-input w-full" :placeholder="t('roadmap.form.titlePlaceholder')"></label>
              <label class="block"><span class="mb-1.5 block text-sm text-white/65">{{ t('roadmap.form.credit') }}</span><input v-model="proposerName" maxlength="80" class="nd-input w-full" :placeholder="t('roadmap.form.creditPlaceholder')"><span class="mt-1 block text-xs text-white/35">{{ t('roadmap.form.creditHint') }}</span></label>
              <label class="block"><span class="mb-1.5 block text-sm text-white/65">{{ t('roadmap.form.note') }}</span><textarea v-model="proposalNote" maxlength="2000" rows="3" class="nd-input w-full resize-y" :placeholder="t('roadmap.form.notePlaceholder')" /></label>
              <button type="submit" class="nd-btn-accent w-full" :disabled="working">{{ t('roadmap.form.submit') }}</button>
            </form>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.roadmap-banner-image {
  background-image: url('/assets/roadmap-haruhi.webp');
  background-position: center 82%;
  background-size: cover;
  filter: grayscale(12%) saturate(72%) brightness(55%);
  opacity: .4;
}
.roadmap-timeline-item::before,
.roadmap-timeline-item::after,
.feature-roadmap-item::before,
.feature-roadmap-item::after {
  content: '';
  position: absolute;
  left: .5625rem;
  width: 2px;
  background: rgba(255, 255, 255, .16);
}
.roadmap-timeline-item::before,
.feature-roadmap-item::before { top: 0; height: .625rem; }
.roadmap-timeline-item::after,
.feature-roadmap-item::after { top: .625rem; bottom: 0; }
.roadmap-timeline-item:first-child::before,
.feature-roadmap-item:first-child::before,
.roadmap-timeline-item:last-child::after,
.feature-roadmap-item:last-child::after { display: none; }
@media (min-width: 768px) {
  .roadmap-timeline-item::before,
  .roadmap-timeline-item::after,
  .feature-roadmap-item::before,
  .feature-roadmap-item::after { left: 11.6875rem; }
  .roadmap-timeline-item::before,
  .feature-roadmap-item::before { height: calc(50% - 1rem); }
  .roadmap-timeline-item::after,
  .feature-roadmap-item::after { top: calc(50% - 1rem); }
}
.feature-roadmap-content::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1rem;
  left: 0;
  height: 1px;
  background: rgba(255, 255, 255, .1);
}
.proposal-panel { background:var(--surface); }
</style>
