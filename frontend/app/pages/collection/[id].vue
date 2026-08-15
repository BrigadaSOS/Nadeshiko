<script setup lang="ts">
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';
import { DEFAULT_OG_IMAGE_PATH, socialTitle } from '~/utils/metaTags';
import { reportError } from '~/utils/reportError';

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const collectionId = computed(() => String(route.params.id));

// A private collection is answered by the redirect below, so no 404 or 500 may be
// raised on top of it once this is set.
const accessDenied = ref(false);

const fetchSentenceData = async () => {
  const sdk = useNadeshikoSdk();
  const result = await sdk.searchCollectionSegments({
    collectionPublicId: collectionId.value,
    take: 20,
    include: ['media'],
    throwOnError: false,
  });

  if ('error' in result) {
    const status = result.response.status;
    if (status === 403 || status === 401) {
      // Only recorded here. `navigateTo` called from inside an async-data fetcher
      // does not propagate as a redirect during SSR -- it resolves, the fetcher
      // returns, and the render carries on to emit a 200 shell. The redirect is
      // issued from setup below, where it does abort the render.
      accessDenied.value = true;
      return null;
    }
    // A deleted or mistyped collection link is a genuine 404; anything else is our
    // own failure and must not be dressed up as "this collection does not exist".
    if (status === 404) return null;
    throw result.error;
  }

  return resolveSearchResponse(result.data);
};

const fetchStatsData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const data = await sdk.getCollectionStats(collectionId.value);
    return resolveStatsResponse(data);
  } catch (error) {
    // 401 and 403 are ordinary answers now that this asks as the reader rather
    // than as the service: an anonymous visitor cannot read any collection, and
    // a stranger cannot read a private one. The sentence fetch above has already
    // started the redirect; reporting the same refusal again would turn every
    // such visit into an error in the logs.
    const status = (error as { response?: { status?: number }; status?: number })?.response?.status;
    if (status !== 401 && status !== 403) {
      reportError('collection:stats-fetch-failed', error, { 'collection.publicId': collectionId.value });
    }
    return null;
  }
};

const { data: initialSentenceData, error: sentenceError } = await useAsyncData(
  `collection-sentences-${collectionId.value}`,
  () => fetchSentenceData(),
  { server: true, lazy: false, watch: [] },
);

// Refused: this reader may not see this collection, and — since the backend
// requires authentication to read any collection, public ones included — that
// covers every anonymous visitor. Sent from setup so SSR really does answer 302
// rather than rendering a shell for a page the caller cannot have.
if (accessDenied.value) {
  await navigateTo(localePath('/'), { redirectCode: 302, replace: true });
}

// Returning `null` would render the collection as an empty page at HTTP 200, which
// crawlers happily index and users read as "the site is broken".
if (!accessDenied.value) {
  if (sentenceError.value) {
    // Runs during SSR, where a toast has nowhere to go; the error page is what the
    // user sees, and the report is what keeps this visible to us.
    reportError('collection:sentences-fetch-failed', sentenceError.value, {
      'collection.publicId': collectionId.value,
    });
    throw createError({ statusCode: 500, statusMessage: 'Failed to load collection' });
  }
  if (!initialSentenceData.value) {
    throw createError({ statusCode: 404, statusMessage: 'Collection Not Found' });
  }
}

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
      { property: 'og:image', content: `${requestOrigin}${DEFAULT_OG_IMAGE_PATH}` },
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
          <div class="nd-page">
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
</template>
