<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';

const props = withDefaults(
  defineProps<{
    media: Pick<Media, 'category' | 'airingFormat' | 'episodeCount'>;
    // List view shows "Videos: 12"; grid views show "12 Videos".
    labelFirst?: boolean;
  }>(),
  {
    labelFirst: false,
  },
);

const isYoutube = computed(() => props.media?.category === 'YOUTUBE');
const isAudiobook = computed(() => props.media?.category === 'AUDIOBOOK');
const isMovie = computed(() => !isYoutube.value && props.media?.airingFormat === 'MOVIE');
const count = computed(() => props.media?.episodeCount || 0);
const wordKey = computed(() =>
  isYoutube.value ? 'animeList.videos' : isAudiobook.value ? 'animeList.chapters' : 'animeList.episodes',
);
const countKey = computed(() =>
  isYoutube.value ? 'animeList.videoCount' : isAudiobook.value ? 'animeList.chapterCount' : 'animeList.episodeCount',
);
</script>

<template>
  <template v-if="isMovie">{{ $t('searchpage.main.labels.movie') }}</template>
  <template v-else-if="labelFirst">{{ $t(wordKey) }}: {{ count }}</template>
  <template v-else>{{ $t(countKey, { count }) }}</template>
</template>
