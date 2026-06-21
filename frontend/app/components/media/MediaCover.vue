<script setup>
const props = defineProps({
  media: { type: Object, required: true },
  alt: { type: String, default: 'Media cover image' },
});

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
    <img
      :src="media.coverUrl"
      :alt="alt"
      loading="lazy"
      class="relative w-[62%] aspect-square rounded-full object-cover ring-1 ring-white/10 shadow-xl"
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
