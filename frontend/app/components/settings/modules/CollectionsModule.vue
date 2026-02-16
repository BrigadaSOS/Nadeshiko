<script setup lang="ts">
import { getRequestHeader } from 'h3';
import { authApiRequest } from '~/utils/authApi';
import type { SearchResult, SearchResultMedia } from '~/stores/search';

type Collection = {
  id: number;
  name: string;
  userId: number;
  visibility: 'PUBLIC' | 'PRIVATE';
};

type CollectionDetailResponse = {
  id: number;
  name: string;
  userId: number;
  visibility: 'PUBLIC' | 'PRIVATE';
  segments: Array<{
    position?: number;
    note?: string | null;
    result?: {
      uuid: string;
      position: number;
      status: 'DELETED' | 'ACTIVE' | 'SUSPENDED' | 'VERIFIED' | 'INVALID' | 'TOO_LONG';
      startTimeMs: number;
      endTimeMs: number;
      episode: number;
      mediaId: number;
      contentRating: 'SAFE' | 'SUGGESTIVE' | 'QUESTIONABLE' | 'EXPLICIT';
      textJa: { content: string; highlight?: string };
      textEn: { content: string; highlight?: string; isMachineTranslated: boolean };
      textEs: { content: string; highlight?: string; isMachineTranslated: boolean };
      urls: { imageUrl: string; audioUrl: string; videoUrl: string };
    };
  }>;
  includes?: {
    media?: Record<
      string,
      | {
          id: number;
          nameEn: string;
          nameJa: string;
          nameRomaji: string;
          coverUrl: string;
          bannerUrl: string;
          category: 'ANIME' | 'JDRAMA';
        }
      | undefined
    >;
  };
  totalCount: number;
};

type CollectionSegmentRow = {
  position: number;
  note?: string | null;
  result: SearchResult;
};

type OrderedSegmentLang = 'textEn' | 'textEs';

const PAGE_LIMIT = 10;

const { locale } = useI18n();
const { mediaName } = useMediaName();
const { shouldBlur } = useContentRating();

const collections = ref<Collection[]>([]);
const selectedCollectionId = ref<number | null>(null);
const selectedCollectionName = ref('');
const segmentRows = ref<CollectionSegmentRow[]>([]);
const totalCount = ref(0);
const currentPage = ref(1);
const loadingSegments = ref(false);
const revealedContent = ref(new Set<string>());

const orderedSegmentLangs = computed<OrderedSegmentLang[]>(() => {
  if (locale.value === 'en') return ['textEn', 'textEs'];
  return ['textEs', 'textEn'];
});

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

const toSearchResultMedia = (
  mediaMap: CollectionDetailResponse['includes'] extends { media?: infer T } ? T : never,
  mediaId: number,
): SearchResultMedia => {
  const media = mediaMap?.[String(mediaId)];
  if (!media) {
    return {
      mediaId,
      nameRomaji: `Media #${mediaId}`,
      nameEn: `Media #${mediaId}`,
      nameJa: `Media #${mediaId}`,
      coverUrl: '',
      bannerUrl: '',
      category: 'ANIME',
    };
  }

  return {
    mediaId: media.id,
    nameRomaji: media.nameRomaji,
    nameEn: media.nameEn,
    nameJa: media.nameJa,
    coverUrl: media.coverUrl,
    bannerUrl: media.bannerUrl,
    category: media.category,
  };
};

const normalizeCollectionDetail = (detail: CollectionDetailResponse) => {
  const mediaMap = detail.includes?.media;
  const rows: CollectionSegmentRow[] = detail.segments
    .map((entry) => {
      const segment = entry.result;
      if (!segment) return null;
      return {
        position: entry.position ?? segment.position,
        note: entry.note ?? null,
        result: {
          media: toSearchResultMedia(mediaMap, segment.mediaId),
          segment: {
            status: segment.status,
            uuid: segment.uuid,
            position: segment.position,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
            episode: segment.episode,
            textJa: segment.textJa,
            textEn: segment.textEn,
            textEs: segment.textEs,
            contentRating: segment.contentRating,
          },
          urls: {
            imageUrl: segment.urls.imageUrl,
            audioUrl: segment.urls.audioUrl,
            videoUrl: segment.urls.videoUrl,
            blobAudio: null,
            blobAudioUrl: null,
          },
        },
      } satisfies CollectionSegmentRow;
    })
    .filter((row): row is CollectionSegmentRow => row !== null);

  return {
    name: detail.name,
    rows,
    totalCount: detail.totalCount,
  };
};

const fetchCollectionPage = async (collectionId: number, page: number, append = false) => {
  loadingSegments.value = true;
  const detail = await requestWithAuth<CollectionDetailResponse>(
    `/v1/collections/${collectionId}?page=${page}&limit=${PAGE_LIMIT}`,
    {
      id: collectionId,
      name: '',
      userId: 0,
      visibility: 'PRIVATE',
      segments: [],
      totalCount: 0,
    },
  );
  const normalized = normalizeCollectionDetail(detail);

  selectedCollectionId.value = collectionId;
  selectedCollectionName.value = normalized.name;
  totalCount.value = normalized.totalCount;
  currentPage.value = page;
  segmentRows.value = append ? [...segmentRows.value, ...normalized.rows] : normalized.rows;
  loadingSegments.value = false;
};

const selectCollection = async (collectionId: number) => {
  if (loadingSegments.value) return;
  if (selectedCollectionId.value === collectionId) return;
  await fetchCollectionPage(collectionId, 1);
};

const loadMoreSegments = async () => {
  if (!selectedCollectionId.value || loadingSegments.value || !hasMoreSegments.value) return;
  await fetchCollectionPage(selectedCollectionId.value, currentPage.value + 1, true);
};

const formatMsTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const hasMoreSegments = computed(() => segmentRows.value.length < totalCount.value);

const { data: initialData } = await useAsyncData(
  'settings-account-collections-initial',
  async () => {
    const list = await requestWithAuth<Collection[]>('/v1/collections?limit=100', []);
    if (list.length === 0) {
      return {
        collections: [] as Collection[],
        selectedCollectionId: null as number | null,
        selectedCollectionName: '',
        segments: [] as CollectionSegmentRow[],
        totalCount: 0,
      };
    }

    const first = list[0];
    if (!first) {
      return {
        collections: [] as Collection[],
        selectedCollectionId: null as number | null,
        selectedCollectionName: '',
        segments: [] as CollectionSegmentRow[],
        totalCount: 0,
      };
    }
    const detail = await requestWithAuth<CollectionDetailResponse>(
      `/v1/collections/${first.id}?page=1&limit=${PAGE_LIMIT}`,
      {
        id: first.id,
        name: first.name,
        userId: first.userId,
        visibility: first.visibility,
        segments: [],
        totalCount: 0,
      },
    );
    const normalized = normalizeCollectionDetail(detail);

    return {
      collections: list,
      selectedCollectionId: first.id,
      selectedCollectionName: normalized.name || first.name,
      segments: normalized.rows,
      totalCount: normalized.totalCount,
    };
  },
  {
    default: () => ({
      collections: [] as Collection[],
      selectedCollectionId: null as number | null,
      selectedCollectionName: '',
      segments: [] as CollectionSegmentRow[],
      totalCount: 0,
    }),
  },
);

collections.value = initialData.value.collections;
selectedCollectionId.value = initialData.value.selectedCollectionId;
selectedCollectionName.value = initialData.value.selectedCollectionName;
segmentRows.value = initialData.value.segments;
totalCount.value = initialData.value.totalCount;
</script>

<template>
  <div class="dark:bg-card-background p-6 mb-6 mx-auto rounded-lg shadow-md">
    <h3 class="text-lg text-white/90 tracking-wide font-semibold">Collections</h3>
    <div class="border-b pt-4 border-white/10" />

    <p v-if="collections.length === 0" class="mt-4 text-gray-300">No collections yet.</p>

    <div v-else class="mt-4 space-y-2">
      <button
        v-for="collection in collections"
        :key="collection.id"
        class="w-full text-left rounded-lg px-3 py-2 border transition-colors"
        :class="selectedCollectionId === collection.id
          ? 'bg-white/10 border-white/30 text-white'
          : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'"
        @click="selectCollection(collection.id)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium truncate">{{ collection.name }}</span>
          <span class="text-xs px-2 py-0.5 rounded border border-white/20 text-gray-300">{{ collection.visibility }}</span>
        </div>
      </button>
    </div>
  </div>

  <div v-if="selectedCollectionId">
    <p v-if="loadingSegments && segmentRows.length === 0" class="text-gray-300 mb-4">Loading segments...</p>
    <p v-else-if="segmentRows.length === 0" class="text-gray-300 mb-4">No segments in this collection yet.</p>

    <template v-else>
      <div
        v-for="row in segmentRows"
        :key="`${selectedCollectionId}-${row.result.segment.uuid}-${row.position}`"
        class="hover:bg-neutral-800/20 items-stretch rounded-lg transition-all flex flex-col lg:flex-row py-2"
      >
        <div class="h-56 shrink-0 w-auto lg:w-[25rem] min-w-[200px] flex justify-center relative overflow-hidden">
          <img
            :src="row.result.urls.imageUrl"
            class="inset-0 h-full w-full object-cover object-center transition-all duration-300"
            :class="shouldBlur(row.result.segment.contentRating) && !revealedContent.has(row.result.segment.uuid)
              ? 'blur-[60px] scale-125'
              : ''"
          />
          <button
            v-if="shouldBlur(row.result.segment.contentRating)"
            class="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white transition-colors z-10 text-xs"
            @click="revealedContent.has(row.result.segment.uuid)
              ? revealedContent.delete(row.result.segment.uuid)
              : revealedContent.add(row.result.segment.uuid)"
          >
            {{ revealedContent.has(row.result.segment.uuid) ? 'Hide' : 'Show' }}
          </button>
        </div>

        <div class="w-full py-3 sm:py-2 px-4 rounded-e-lg text-white flex flex-col justify-between">
          <div>
            <h3 class="text-xl leading-snug">{{ row.result.segment.textJa.content }}</h3>

            <ul class="ml-5 list-disc text-gray-400 mt-2">
              <li
                v-for="lang in orderedSegmentLangs"
                :key="`${row.result.segment.uuid}-${lang}`"
                class="my-1 text-sm"
              >
                {{ row.result.segment[lang].content }}
              </li>
            </ul>

            <p class="text-sm text-white/60 tracking-wide font-semibold mt-3">
              {{ mediaName(row.result.media) }} &bull; Episode {{ row.result.segment.episode }} &bull; {{ formatMsTime(row.result.segment.startTimeMs) }}
            </p>
            <p v-if="row.note" class="text-sm text-gray-300 mt-2">Note: {{ row.note }}</p>
          </div>

          <div class="mt-3">
            <NuxtLink
              :to="`/sentence/${row.result.segment.uuid}`"
              class="inline-flex items-center px-3 py-1.5 rounded-lg bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium"
            >
              Open Segment
            </NuxtLink>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between mt-4">
        <p class="text-sm text-gray-400">{{ segmentRows.length }} / {{ totalCount }} segments</p>
        <button
          v-if="hasMoreSegments"
          class="bg-button-primary-main hover:bg-button-primary-hover text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-50"
          :disabled="loadingSegments"
          @click="loadMoreSegments"
        >
          {{ loadingSegments ? 'Loading...' : 'Load more' }}
        </button>
      </div>
    </template>
  </div>
</template>
