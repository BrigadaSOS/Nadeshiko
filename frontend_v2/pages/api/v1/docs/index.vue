<script setup lang="ts">
const { $ScalarApiReference } = useNuxtApp()

const config = {
  url: '/nadeshikoapi.yaml',
  theme: 'deepSpace',
  layout: 'modern',
  darkMode: true,
}
</script>

<template>
  <ClientOnly>
    <template #default>
      <component :is="$ScalarApiReference" :configuration="config" />
    </template>
    <template #fallback>
      <div class="flex items-center justify-center p-10 text-gray-500">
        Loading...
      </div>
    </template>
  </ClientOnly>
</template>
