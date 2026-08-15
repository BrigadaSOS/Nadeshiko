<script setup lang="ts">
/**
 * The star that adds a title to the reader's favourites, shown both on a title
 * row and on the back row once they have drilled into that title's episodes --
 * one component so the two cannot drift apart.
 *
 * Always a sibling of the row's own button, never a child: a button inside a
 * button is invalid and breaks hydration.
 *
 * It carries no margin of its own. The two call sites need different ones -- a
 * row insets it from its border, the header has to pull it back out of the
 * header's padding -- and a margin here plus an override there is a coin toss:
 * Tailwind resolves two utilities for one property by stylesheet order, not by
 * the order they are written in the class attribute, so the header's `-mr-2`
 * quietly lost to this component's `mr-2` and left the star (and the count in
 * front of it) 16px off the column the rows use.
 */
// Both branches below are roots, and Vue only hands the caller's class to the
// first of them; the spacer would silently render without the margin the star
// gets. Bound by hand so the two stay the same width.
defineOptions({ inheritAttrs: false });

const user = userStore();
const { isFavorite, atCap, toggleFavorite } = useFavoriteMedia();

/**
 * `mediaPublicId` is nullable because the episode rows pass a spacer with no
 * title -- they are not a thing you star, but the title above them is, and the
 * empty column keeps those counts under that one. The rule that a missing id
 * gets no star lives here rather than in a `v-if` at each call site.
 */
const props = defineProps<{
  media: {
    mediaPublicId: string | null;
    nameEn?: string;
    nameJa?: string;
    nameRomaji?: string;
  };
}>();

/** The title this star is about, or nothing when the row is not one. */
const mediaPublicId = computed(() => props.media.mediaPublicId);

const starred = computed(() => !!mediaPublicId.value && isFavorite(mediaPublicId.value));

const onToggle = () => {
  const publicId = mediaPublicId.value;
  if (!publicId) return;

  void toggleFavorite({
    publicId,
    nameEn: props.media.nameEn,
    nameJa: props.media.nameJa,
    nameRomaji: props.media.nameRomaji,
  });
};
</script>

<template>
  <button
    v-if="user.isLoggedIn && mediaPublicId"
    v-bind="$attrs"
    type="button"
    :aria-label="starred ? $t('searchpage.main.buttons.unfavoriteMedia') : $t('searchpage.main.buttons.favoriteMedia')"
    :aria-pressed="starred"
    :disabled="atCap && !starred"
    :title="atCap && !starred ? $t('favoriteMedia.capReached') : undefined"
    data-testid="media-filter-favorite"
    class="shrink-0 p-1 rounded hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent outline-none"
    @click.stop="onToggle">
    <svg class="w-4 h-4" :class="starred ? 'text-yellow-400' : 'text-white/40'"
      :fill="starred ? 'currentColor' : 'none'" stroke="currentColor"
      stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M11.48 3.5a.56.56 0 011.04 0l2.13 4.9 5.32.52c.5.05.7.67.32 1l-4.02 3.5 1.18 5.22c.11.49-.42.88-.85.62L12 16.6l-4.6 2.66c-.43.26-.96-.13-.85-.62l1.18-5.22-4.02-3.5c-.38-.33-.18-.95.32-1l5.32-.52 2.13-4.9z" />
    </svg>
  </button>
  <!-- A row with no title to star still holds the star's column open, so its
       count lands under the counts of the rows that do have one. Only worth it
       while some row in the list has a star: signed out, nothing does, and every
       row runs to the edge. -->
  <span v-else-if="user.isLoggedIn" v-bind="$attrs" aria-hidden="true" class="shrink-0 p-1">
    <span class="block w-4 h-4"></span>
  </span>
</template>
