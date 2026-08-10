<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';

const props = withDefaults(
  defineProps<{
    media: Pick<Media, 'category' | 'coverUrl'>;
    alt?: string;
  }>(),
  {
    alt: 'Media cover image',
  },
);

const isYoutube = computed(() => props.media?.category === 'YOUTUBE');
</script>

<template>
  <div
    v-if="isYoutube"
    class="absolute inset-0 overflow-hidden flex items-center justify-center bg-neutral-900"
  >
    <img
      :src="media.coverUrl"
      :alt="alt"
      loading="lazy"
      class="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.85]"
    />
    <div class="absolute inset-0 bg-black/20"></div>
    <!--
      YouTube channel avatars are always square at the source. Older covers were
      baked into the 460x690 poster frame by a non-uniform resize, so they arrive
      vertically stretched. `object-fill` into a square box maps the whole image
      back onto its original 1:1 frame, exactly undoing that stretch — and it is a
      no-op for covers generated after the pipeline fix, which are already square.
    -->
    <img
      :src="media.coverUrl"
      :alt="alt"
      loading="lazy"
      class="relative w-[62%] aspect-square rounded-full object-fill ring-1 ring-white/10 shadow-xl"
    />
  </div>
  <img
    v-else
    :src="media.coverUrl"
    :alt="alt"
    loading="lazy"
    class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-in-out"
  />
</template>
