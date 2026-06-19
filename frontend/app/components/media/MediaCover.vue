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
    class="absolute inset-0 overflow-hidden"
  >
    <img
      :src="media.coverUrl"
      :alt="alt"
      loading="lazy"
      class="absolute inset-0 w-full h-full object-cover scale-150 blur-xl brightness-[0.35]"
    />
    <!-- Channel avatar -->
    <img
      :src="media.coverUrl"
      :alt="alt"
      loading="lazy"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square rounded-full object-cover"
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
