<script setup lang="ts">
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';
import { socialTitle } from '~/utils/metaTags';

const route = useRoute();
const localePath = useLocalePath();

const collectionId = computed(() => String(route.params.id));

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const result = await sdk.searchCollectionSegments({
      collectionPublicId: collectionId.value,
      take: 20,
      include: ['media'],
      throwOnError: false,
    });
    if ('error' in result) {
      if (result.response.status === 403 || result.response.status === 401) {
        await navigateTo(localePath('/'), { redirectCode: 302 });
      }
      return null;
    }
    return resolveSearchResponse(result.data);
  } catch {
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const data = await sdk.getCollectionStats(collectionId.value);
    return resolveStatsResponse(data);
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
    const result = await sdk.getCollection({
      collectionPublicId: collectionId.value,
      throwOnError: false,
    });
    if ('error' in result) {
      if (result.response.status === 403 || result.response.status === 401) {
        await navigateTo(localePath('/'), { redirectCode: 302 });
      }
      return null;
    }
    return { name: result.data.name };
  },
  { server: true, lazy: false },
);

const requestOrigin = useRequestURL().origin;

const metaTags = computed(() => {
  const name = collectionDetails.value?.name ?? 'Collection';
  const title = name;
  const social = socialTitle(title);
  const description = `Browse the "${name}" collection on Nadeshiko`;
  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: `${requestOrigin}/logo-og-5bc76788.png` },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ],
  };
});

useHead(metaTags);

useSchemaOrg([defineWebPage({ '@type': 'CollectionPage' })]);

if (import.meta.client) {
  const posthog = usePostHog();
  posthog?.capture('collection_viewed', {
    collection_id: collectionId.value,
    item_count: initialSentenceData.value?.pagination?.estimatedTotalHits ?? 0,
  });
}
</script>

<template>
  <div class="mx-auto">
      <div class="relative text-white">
        <div class="pt-2">
          <div class="md:max-w-[70%] mx-auto">
            <h1 class="sr-only">{{ metaTags.title }}</h1>
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
