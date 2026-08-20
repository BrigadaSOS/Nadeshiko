<script setup lang="ts">
import { buildWordSearchPath } from '~/utils/routes';

/**
 * Links from one word page to its kanji relatives.
 *
 * These exist as much for crawlers as for readers: the word pages were
 * effectively orphans, reachable from the sitemap and from the search box and
 * from almost nothing else. See `server/utils/relatedWordsIndex.ts` for how the
 * relation is chosen.
 *
 * Presentational on purpose -- the page fetches the list with the rest of its
 * data. Fetching here would make this an async component nested inside the
 * page's own Suspense boundary, which re-suspends the whole page whenever it
 * mounts; and doing it client-side instead would leave the links out of the HTML
 * a crawler receives, which is the entire point of having them.
 */
defineProps<{ words: { word: string; matchCount: number }[] }>();

const localePath = useLocalePath();
// Not `toLocaleString()`: with no locale argument it reads the RUNTIME's, which
// is the server's on the way out and the reader's browser on the way back, so
// `23,931` server-side became `23.931` for a German reader and hydration found
// two different strings. `formatNumber` is bound to the page's own locale, so
// both renders agree. See `i18n.config.ts`, where dates already pin for this.
const { formatNumber } = useFormat();
</script>

<template>
  <section v-if="words.length" class="mt-10 border-t border-white/10 pt-6">
    <h2 class="mb-3 text-lg font-semibold dark:text-gray-100">{{ $t('searchpage.relatedWords.heading') }}</h2>
    <ul class="flex flex-wrap gap-2">
      <li v-for="item in words" :key="item.word">
        <NuxtLink
          :to="localePath(buildWordSearchPath(item.word))"
          lang="ja"
          class="inline-flex items-baseline gap-1.5 rounded-full bg-[rgba(255,255,255,0.06)] px-3 py-1 text-sm transition-colors hover:bg-[rgba(255,255,255,0.12)] dark:text-gray-200">
          {{ item.word }}
          <span class="text-xs dark:text-gray-500">{{ formatNumber(item.matchCount) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
