<template>
  <div ref="observer" class="h-10 w-full"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const observer = ref(null)
const emit = defineEmits(['intersect'])

onMounted(() => {
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    if (entry && entry.isIntersecting) {
      emit('intersect')
    }
  }, {
    rootMargin: '200px',
    threshold: 0.1
  })

  if (observer.value) {
    intersectionObserver.observe(observer.value)
  }

  onUnmounted(() => {
    intersectionObserver.disconnect()
  })
})
</script>