<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';

/**
 * The title card at the top of `/media/<slug>`.
 *
 * The page had its own URL before it had anything of its own to say: the body
 * was a sentence list identical in shape to a search, so nothing on it named the
 * work, dated it, or said what kind of thing it was. That is thin for a page
 * whose whole subject is one title, and it left the `<h1>` as the only piece of
 * text about the work -- screen-reader-only at that.
 *
 * Everything here comes from the media payload the page already fetched, so it
 * costs no extra request.
 */
const props = withDefaults(
  defineProps<{
    media: Media;
    /**
     * `h1` on the title's own page. A word search narrowed to this title already
     * has the word as its heading, so the card is `h2` there.
     */
    heading?: 'h1' | 'h2';
  }>(),
  { heading: 'h1' },
);

const { mediaName, language } = useMediaName();

const title = computed(() => mediaName(props.media));

/**
 * The names this reader is NOT seeing as the headline, so a page titled in
 * romaji still carries its Japanese and English names for anyone -- or anything
 * -- searching by those instead.
 */
const secondaryNames = computed(() => {
  const byLanguage: Record<string, string | undefined> = {
    ENGLISH: props.media.nameEn,
    JAPANESE: props.media.nameJa,
    ROMAJI: props.media.nameRomaji,
  };

  return (['ENGLISH', 'JAPANESE', 'ROMAJI'] as const)
    .filter((key) => key !== language.value)
    .map((key) => ({ key, value: byLanguage[key] }))
    .filter((entry): entry is { key: 'ENGLISH' | 'JAPANESE' | 'ROMAJI'; value: string } => Boolean(entry.value))
    .filter((entry) => entry.value !== title.value);
});

/** The season a title belongs to, as one string -- either half can be missing. */
const season = computed(() => {
  const { seasonName, seasonYear } = props.media;
  if (seasonName && seasonYear) return `${seasonName} ${seasonYear}`;
  return seasonName || (seasonYear ? `${seasonYear}` : null);
});

const facts = computed(() =>
  [
    { label: 'modalMediaEdit.studio', value: props.media.studio },
    { label: 'modalMediaEdit.seasonName', value: season.value },
    { label: 'modalMediaEdit.airingStatus', value: props.media.airingStatus },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value)),
);

const genres = computed(() => props.media.genres ?? []);
</script>

<template>
  <header class="mb-3 overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)]">
    <!-- Decorative: the title is spelled out in the heading directly below, so an
         alt text here would only make a screen reader read the name twice. -->
    <div v-if="media.bannerUrl" class="relative h-32 w-full sm:h-44">
      <img :src="media.bannerUrl" alt="" class="h-full w-full object-cover" loading="eager" fetchpriority="high" />
      <div class="absolute inset-0 bg-gradient-to-t from-[#1d1d1d] via-[#1d1d1d]/40 to-transparent"></div>
    </div>

    <div class="flex gap-4 p-4 sm:gap-6 sm:p-6" :class="media.bannerUrl ? '-mt-12 sm:-mt-16' : ''">
      <div class="relative z-10 w-24 flex-none overflow-hidden rounded-lg shadow-lg sm:w-32">
        <div class="aspect-[2/3]">
          <MediaCover :media="media" :alt="title" />
        </div>
      </div>

      <div class="relative z-10 flex min-w-0 flex-auto flex-col justify-end">
        <component
          :is="heading"
          lang="ja"
          class="text-2xl font-extrabold leading-tight dark:text-white sm:text-3xl"
        >{{ title }}</component>

        <p v-if="secondaryNames.length" class="mt-1 text-sm dark:text-gray-400">
          <span v-for="(name, index) in secondaryNames" :key="name.key">
            <span :lang="name.key === 'JAPANESE' ? 'ja' : undefined">{{ name.value }}</span>
            <span v-if="index < secondaryNames.length - 1"> · </span>
          </span>
        </p>

        <p class="mt-3 text-sm font-medium dark:text-gray-200">
          {{ media.segmentCount.toLocaleString() }} {{ $t('animeList.sentenceCount') }}
          <span class="dark:text-gray-500"> · </span>
          <MediaCountLabel :media="media" />
        </p>

        <dl v-if="facts.length" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm dark:text-gray-400">
          <div v-for="fact in facts" :key="fact.label" class="flex gap-1">
            <dt class="dark:text-gray-500">{{ $t(fact.label) }}:</dt>
            <dd>{{ fact.value }}</dd>
          </div>
        </dl>

        <ul v-if="genres.length" class="mt-3 flex flex-wrap gap-1.5">
          <li
            v-for="genre in genres"
            :key="genre"
            class="rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-0.5 text-xs dark:text-gray-300">
            {{ genre }}
          </li>
        </ul>
      </div>
    </div>
  </header>
</template>
