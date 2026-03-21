<script setup lang="ts">
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';

const route = useRoute();

const collectionId = computed(() => String(route.params.id));

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const { data, response } = await sdk.getCollection({
      path: { id: collectionId.value },
      query: { take: 20 },
    });
    if (response.status === 403 || response.status === 401) {
      await navigateTo('/', { redirectCode: 302 });
      return null;
    }
    if (!data) return null;
    const segments = (data.segments ?? []).map((entry: any) => entry.result).filter(Boolean);
    return resolveSearchResponse({
      segments,
      includes: data.includes,
      pagination: {
        hasMore: data.pagination?.hasMore ?? false,
        cursor: data.pagination?.cursor ?? '',
        estimatedTotalHits: data.totalCount ?? 0,
        estimatedTotalHitsRelation: 'EXACT',
      },
    });
  } catch {
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const { data } = await sdk.getCollectionStats({ path: { id: collectionId.value } });
    return data ? resolveStatsResponse(data) : null;
  } catch {
    return null;
  }
};

const { data: initialSentenceData } = await useAsyncData(
  `collection-sentences-${collectionId.value}`,
  () => fetchSentenceData(),
  { server: true, lazy: false, watch: [] },
);

const { data: initialStatsData } = await useAsyncData(
  `collection-stats-${collectionId.value}`,
  () => fetchStatsData(),
  { server: true, lazy: false, watch: [] },
);

const { data: collectionDetails } = await useAsyncData(
  `collection-details-${collectionId.value}`,
  async () => {
    const sdk = useNadeshikoSdk();
    const { data, response } = await sdk.getCollection({
      path: { id: collectionId.value },
      query: { take: 1 },
    });
    if (response.status === 403 || response.status === 401) {
      await navigateTo('/', { redirectCode: 302 });
      return null;
    }
    return data ? { name: data.name } : null;
  },
  { server: true, lazy: false },
);

const metaTags = computed(() => {
  const name = collectionDetails.value?.name ?? 'Collection';
  const title = name;
  const description = `Browse the "${name}" collection on Nadeshiko`;
  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
    ],
  };
});

useHead(metaTags);

useSchemaOrg([defineWebPage({ '@type': 'CollectionPage' })]);
</script>

<template>
  <div class="mx-auto">
      <div class="relative text-white">
        <div class="pt-2">
          <div class="md:max-w-[92%] mx-auto">
            <SearchBaseInputSegment />
            <SearchContainer
              :initial-sentence-data="initialSentenceData"
              :initial-stats-data="initialStatsData"
              :collection-id="collectionId"
              :collection-name="collectionDetails?.name ?? undefined"
            />
          </div>
        </div>
      </div>
    </div>
</template>
