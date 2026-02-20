<template>
  <div ref="observer" class="h-10 w-full"></div>
</template>

<script setup>
const observer = ref(null);
const emit = defineEmits(['intersect']);
const intersectionObserver = ref(null);

onMounted(async () => {
  await nextTick();

  intersectionObserver.value = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        emit('intersect');
      }
    },
    {
      rootMargin: '1200px',
      threshold: 0.1,
    },
  );

  if (observer.value) {
    intersectionObserver.value.observe(observer.value);
  }
});

onUnmounted(() => {
  if (intersectionObserver.value) {
    intersectionObserver.value.disconnect();
  }
});
</script>