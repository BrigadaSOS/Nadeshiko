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
const isMovie = computed(() => !isYoutube.value && props.media?.airingFormat === 'MOVIE');
const count = computed(() => props.media?.episodeCount || 0);
const wordKey = computed(() => (isYoutube.value ? 'animeList.videos' : 'animeList.episodes'));
</script>

<template>
  <template v-if="isMovie">{{ $t('searchpage.main.labels.movie') }}</template>
  <template v-else-if="labelFirst">{{ $t(wordKey) }}: {{ count }}</template>
  <template v-else>{{ count }} {{ $t(wordKey) }}</template>
</template>
