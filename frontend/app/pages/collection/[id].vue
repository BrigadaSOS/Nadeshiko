<script setup lang="ts">
import type { SearchScope } from '~/composables/useSearchFetch';
import { DEFAULT_OG_IMAGE_PATH, DEFAULT_OG_IMAGE_SIZE, buildOgImageTags, socialTitle } from '~/utils/metaTags';

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const collectionId = computed(() => String(route.params.id));

const { fetchSentences, fetchStats } = useSearchFetch();
const scope = computed<SearchScope>(() => ({
  query: '',
  category: 'all',
  mediaPublicId: null,
  episode: null,
  sort: null,
  randomSeed: null,
  segmentPublicId: null,
  collectionId: collectionId.value,
  listMediaIds: null,
  contentRating: [],
  languages: undefined,
  hiddenMediaExclude: [],
  hiddenCategories: [],
}));

const { data: initialSentenceOutcome } = await useAsyncData(
  `collection-sentence-outcomes-${collectionId.value}`,
  () => fetchSentences(scope.value),
  { server: true, lazy: false, watch: [] },
);

if (initialSentenceOutcome.value?.status === 'forbidden') {
  await navigateTo(localePath('/'), { redirectCode: 302, replace: true });
} else if (initialSentenceOutcome.value?.status === 'error') {
  // Invalid/missing collection ids are lookup failures, not search expressions.
  const failureKind = initialSentenceOutcome.value.failure.kind;
  if (failureKind === 'not-found' || failureKind === 'unavailable') {
    const statusCode = failureKind === 'not-found' ? 404 : 500;
    throw createError({
      statusCode,
      statusMessage: statusCode === 404 ? 'Collection Not Found' : 'Failed to load collection',
    });
  }
}

const { data: initialStatsOutcome } = await useAsyncData(
  `collection-stats-outcomes-${collectionId.value}`,
  () => fetchStats(scope.value),
  { server: true, lazy: false, watch: [] },
);
if (initialStatsOutcome.value?.status === 'forbidden') {
  await navigateTo(localePath('/'), { redirectCode: 302, replace: true });
}

const { data: collectionDetails } = await useAsyncData(
  `collection-details-${collectionId.value}`,
  async () => {
    const sdk = useNadeshikoSdk();
    const result = await sdk.getCollection({
      collectionPublicId: collectionId.value,
      throwOnError: false,
    });
    if ('error' in result) {
      // No redirect here. A refusal on this call cannot happen without the same
      // refusal on the sentence fetch above -- both go through the backend's
      // `loadReadableCollection` -- and that one has already redirected out of
      // setup. Calling `navigateTo` from inside a fetcher would not work anyway.
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
  const description = t('seo.collection.description', { name });
  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      ...buildOgImageTags(`${requestOrigin}${DEFAULT_OG_IMAGE_PATH}`, DEFAULT_OG_IMAGE_SIZE),
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
    item_count:
      initialSentenceOutcome.value?.status === 'ok'
        ? (initialSentenceOutcome.value.data.pagination?.estimatedTotalHits ?? 0)
        : 0,
  });
}
</script>

<template>
  <div class="mx-auto">
      <div class="relative text-white">
          <div class="nd-page">
            <h1 class="sr-only">{{ metaTags.title }}</h1>
            <SearchBaseInputSegment />
            <SearchContainer
              :initial-sentence-outcome="initialSentenceOutcome"
              :initial-stats-outcome="initialStatsOutcome"
              :collection-id="collectionId"
              :collection-name="collectionDetails?.name ?? undefined"
            />
          </div>
      </div>
    </div>
</template>
