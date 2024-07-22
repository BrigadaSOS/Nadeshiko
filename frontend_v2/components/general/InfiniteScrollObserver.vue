<template>
    <div ref="observer"></div>
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
      rootMargin: '800px'
    })
  
    intersectionObserver.observe(observer.value)
  
    onUnmounted(() => {
      intersectionObserver.disconnect()
    })
  })
  </script>