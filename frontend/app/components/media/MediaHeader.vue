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

/**
 * Outbound catalog links. Anime usually has AniList, J-drama TMDB, and a
 * YouTube channel its channel id — the title card used to name the work and
 * then leave the reader with no way onto any of them.
 */
const catalogLinks = computed(() => {
  const ids = props.media.externalIds;
  const links: {
    href: string;
    labelKey: 'animeList.anilistButton' | 'animeList.tmdbButton' | 'animeList.imdbButton' | 'animeList.youtubeButton';
    testId: string;
  }[] = [];
  if (ids?.anilist) {
    links.push({
      href: anilistAnimeUrl(ids.anilist),
      labelKey: 'animeList.anilistButton',
      testId: 'media-anilist-link',
    });
  }
  if (ids?.tmdb) {
    links.push({
      href: tmdbUrl(ids.tmdb, props.media.airingFormat),
      labelKey: 'animeList.tmdbButton',
      testId: 'media-tmdb-link',
    });
  }
  if (ids?.imdb) {
    links.push({
      href: imdbTitleUrl(ids.imdb),
      labelKey: 'animeList.imdbButton',
      testId: 'media-imdb-link',
    });
  }
  if (ids?.youtube) {
    links.push({
      href: youtubeChannelUrl(ids.youtube),
      labelKey: 'animeList.youtubeButton',
      testId: 'media-youtube-link',
    });
  }
  return links;
});
</script>

<template>
  <header data-testid="media-header" class="mb-3 rounded-lg bg-[rgba(255,255,255,0.06)]">
    <div class="flex gap-3 p-3 sm:gap-5 sm:p-5">
      <!--
        Aspect lives on the same box that is `relative`, because MediaCover
        fills its nearest positioned ancestor with `inset-0`. `self-start`
        stops the flex row stretching that box to the text column's height.
      -->
      <div class="relative aspect-[2/3] w-24 shrink-0 self-start overflow-hidden rounded-lg sm:w-32">
        <MediaCover :media="media" :alt="title" />
      </div>

      <div class="min-w-0 flex-1">
        <component
          :is="heading"
          lang="ja"
          class="text-xl font-extrabold leading-tight dark:text-white sm:text-3xl"
        >{{ title }}</component>

        <p v-if="secondaryNames.length" class="mt-1 text-sm dark:text-gray-400">
          <span v-for="(name, index) in secondaryNames" :key="name.key">
            <span :lang="name.key === 'JAPANESE' ? 'ja' : undefined">{{ name.value }}</span>
            <span v-if="index < secondaryNames.length - 1"> · </span>
          </span>
        </p>

        <p class="mt-2 text-sm font-medium dark:text-gray-200 sm:mt-3">
          {{ media.segmentCount.toLocaleString() }} {{ $t('animeList.sentenceCount') }}
          <span class="dark:text-gray-500"> · </span>
          <MediaCountLabel :media="media" />
        </p>

        <dl v-if="facts.length" class="mt-2 hidden text-sm dark:text-gray-400 sm:flex sm:flex-wrap sm:gap-x-4">
          <div v-for="fact in facts" :key="fact.label" class="flex gap-1">
            <dt class="shrink-0 dark:text-gray-500">{{ $t(fact.label) }}:</dt>
            <dd>{{ fact.value }}</dd>
          </div>
        </dl>

        <ul v-if="genres.length" class="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
          <li
            v-for="genre in genres"
            :key="genre"
            class="rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-0.5 text-xs dark:text-gray-300">
            {{ genre }}
          </li>
        </ul>

        <ul v-if="catalogLinks.length" class="mt-2 flex flex-wrap gap-2 sm:mt-3">
          <li v-for="link in catalogLinks" :key="link.href">
            <a
              :href="link.href"
              :data-testid="link.testId"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center rounded-full border border-white/20 px-2.5 py-0.5 text-xs dark:text-gray-300 transition-colors hover:border-white/40 dark:hover:text-white"
            >
              {{ $t(link.labelKey) }}
            </a>
          </li>
        </ul>
      </div>
    </div>
  </header>
</template>
