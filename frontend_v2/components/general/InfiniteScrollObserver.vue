<template>
  <div ref="observer" class="h-10 w-full"></div>
</template>

<script setup>
const observer = ref(null)
const emit = defineEmits(['intersect'])
const intersectionObserver = ref(null)

const checkInitialIntersection = () => {
  if (!observer.value) return
  
  const rect = observer.value.getBoundingClientRect()
  const windowHeight = window.innerHeight
  
  if (rect.top < windowHeight) {
    emit('intersect')
  }
}

onMounted(async () => {
  await nextTick()
  
  intersectionObserver.value = new IntersectionObserver(([entry]) => {
    if (entry && entry.isIntersecting) {
      emit('intersect')
    }
  }, {
    rootMargin: '1200px',
    threshold: 0.1
  })

  if (observer.value) {
    intersectionObserver.value.observe(observer.value)
    
    setTimeout(() => {
      checkInitialIntersection()
    }, 100)

    window.addEventListener('scroll', checkInitialIntersection, { passive: true })
  }
})

onUnmounted(() => {
  if (intersectionObserver.value) {
    intersectionObserver.value.disconnect()
  }
  window.removeEventListener('scroll', checkInitialIntersection)
})
</script>