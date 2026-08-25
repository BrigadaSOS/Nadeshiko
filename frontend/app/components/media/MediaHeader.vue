<script setup lang="ts">
import { mdiChevronDown } from '@mdi/js';
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
 *
 * It is a disclosure now rather than a fixed block. The card sits between the
 * tabs and the sentences, which are what the page is actually for, and at its
 * old size it took a third of a phone's viewport.
 *
 * Two layouts, not a panel that unfolds under a fixed header. Open is the card
 * as it always looked -- poster, full-size title, the details beside it. Closed
 * is one line: a thumbnail, the title, and the counts. What moves between them
 * is the SAME elements rather than two subtrees crossfading, which is what keeps
 * a single `<h1>` on the page and lets the poster and the heading animate to
 * size instead of popping.
 *
 * `useMediaCardDefault` says which way it starts; the card itself opens and
 * closes for anybody, signed in or not, because that state is nothing worth
 * storing.
 *
 * The details are hidden by a collapsed grid row rather than by `v-if`, so they
 * stay in the markup at every size: one reader closing their card does not
 * change what the page says about the work.
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

const { t } = useI18n();
const { mediaName, language } = useMediaName();
const { formatNumber } = useFormat();
const { startsOpen } = useMediaCardDefault();

const title = computed(() => mediaName(props.media));

/**
 * Local, and seeded rather than bound: the preference is a starting position,
 * so opening one title's card must not quietly rewrite the setting for every
 * other. Seeded during SSR too, which is what keeps the first paint right
 * instead of correct-after-hydration.
 */
const open = ref(startsOpen.value);
// The setting can change under a mounted card -- the settings page is a route
// away, and coming back does not remount this.
watch(startsOpen, (next) => {
  open.value = next;
});

const toggle = () => {
  open.value = !open.value;
};

/**
 * The whole card is the target, not just the chevron. Two things it must not
 * swallow: a click on one of the catalogue links, which is a navigation and not
 * a toggle, and a click that ends a text selection -- collapsing the card out
 * from under a reader dragging across the Japanese title is the kind of thing
 * that makes a page feel hostile.
 */
const onCardClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('a, button')) return;
  if (import.meta.client && !window.getSelection()?.isCollapsed) return;
  toggle();
};

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

/**
 * One id per rendered card, so the chevron's `aria-controls` points at this
 * card's details and not at another instance's. `useId` is stable across the
 * server and client renders, which a counter would not be.
 */
const detailsId = `media-header-details-${useId()}`;
</script>

<template>
  <header
    data-testid="media-header"
    :data-open="open"
    class="mb-3 cursor-pointer overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)] transition-colors hover:bg-[rgba(255,255,255,0.09)]"
    @click="onCardClick"
  >
    <div class="flex items-center gap-2.5 p-2.5 sm:gap-4 sm:px-4">
      <!--
        Aspect lives on the same box that is `relative`, because MediaCover
        fills its nearest positioned ancestor with `inset-0`. Width is what
        animates and the ratio carries the height along with it, so the poster
        grows out of the thumbnail rather than replacing it.
      -->
      <div
        class="relative aspect-[2/3] shrink-0 overflow-hidden transition-[width,border-radius] duration-300 ease-out"
        :class="open ? 'w-20 rounded-lg sm:w-24' : 'w-8 rounded'"
      >
        <MediaCover :media="media" :alt="title" />
      </div>

      <div class="min-w-0 flex-1">
        <!-- The chevron rides the title's own line in both layouts, so it has
             nowhere to jump to when the card changes height. -->
        <div class="flex min-w-0 items-baseline gap-2">
          <component
            :is="heading"
            lang="ja"
            class="min-w-0 flex-1 font-extrabold leading-tight transition-[font-size,line-height] duration-300 ease-out dark:text-white"
            :class="open ? 'text-lg sm:text-2xl' : 'truncate text-sm sm:text-base'"
          >{{ title }}</component>

          <!-- `.stop`, or the card handler above would toggle it straight back. -->
          <button
            type="button"
            data-testid="media-header-toggle"
            class="nd-btn size-7 shrink-0 self-center p-0"
            :aria-expanded="open"
            :aria-controls="detailsId"
            :title="open ? t('mediaHeader.collapse') : t('mediaHeader.expand')"
            :aria-label="open ? t('mediaHeader.collapse') : t('mediaHeader.expand')"
            @click.stop="toggle"
          >
            <UiBaseIcon
              :path="mdiChevronDown"
              w="w-4"
              h="h-4"
              size="16"
              class="transition-transform duration-300 ease-out"
              :class="{ 'rotate-180': open }"
              aria-hidden="true"
            />
          </button>
        </div>

        <!-- Under the name rather than beside it, and in both layouts: the counts
             are the one thing a reader wants from a card they have closed, and a
             line that moves sideways when the card opens is a line that pops. -->
        <p
          class="mt-0.5 transition-[font-size,line-height,color] duration-300 ease-out"
          :class="open ? 'text-sm dark:text-gray-200' : 'text-xs dark:text-gray-400'"
        >
          {{ formatNumber(media.segmentCount) }} {{ $t('animeList.sentenceCount') }}
          <span class="dark:text-gray-500"> · </span>
          <MediaCountLabel :media="media" />
        </p>

        <!--
          Collapsed by a grid row rather than by height, which is what lets it
          animate to the content's own size without measuring anything in JS.
          The motion tiers in `tailwind.css` take it from here: `reduced` drops
          `grid-template-rows` from the allowed transition properties and keeps
          the fade, `none` shortens both to nothing.
        -->
        <div
          :id="detailsId"
          class="grid transition-[grid-template-rows] duration-300 ease-out"
          :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        >
          <div class="overflow-hidden">
            <div class="pt-1.5 transition-opacity duration-200 ease-out" :class="open ? 'opacity-100' : 'opacity-0'">
              <p v-if="secondaryNames.length" class="text-xs dark:text-gray-400 sm:text-sm">
                <span v-for="(name, index) in secondaryNames" :key="name.key">
                  <span :lang="name.key === 'JAPANESE' ? 'ja' : undefined">{{ name.value }}</span>
                  <span v-if="index < secondaryNames.length - 1"> · </span>
                </span>
              </p>

              <dl v-if="facts.length" class="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm dark:text-gray-400">
                <div v-for="fact in facts" :key="fact.label" class="flex gap-1">
                  <dt class="shrink-0 dark:text-gray-500">{{ $t(fact.label) }}:</dt>
                  <dd>{{ fact.value }}</dd>
                </div>
              </dl>

              <!-- Genres and catalog links share a row rather than taking one
                   each. Two lists still, because they are two lists. -->
              <div
                v-if="genres.length || catalogLinks.length"
                class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5"
              >
                <ul v-if="genres.length" class="flex flex-wrap gap-1.5">
                  <li
                    v-for="genre in genres"
                    :key="genre"
                    class="rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-0.5 text-xs dark:text-gray-300">
                    {{ genre }}
                  </li>
                </ul>

                <ul v-if="catalogLinks.length" class="flex flex-wrap gap-1.5">
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
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
