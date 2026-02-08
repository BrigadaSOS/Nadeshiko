<script setup lang="ts">
const { $ScalarApiReference } = useNuxtApp();

const apiReferenceConfig = {
  url: 'https://raw.githubusercontent.com/BrigadaSOS/Nadeshiko/main-v2/backend/docs/generated/openapi.yaml',
  theme: 'deepSpace' as const,
  layout: 'modern' as const,
  darkMode: true,
  hiddenTags: ['User', 'Admin'],
};
</script>

<template>
  <ClientOnly>
    <template #default>
      <component :is="$ScalarApiReference" :configuration="apiReferenceConfig" />
    </template>
    <template #fallback>
      <div class="flex items-center justify-center p-10 text-gray-500">
        Loading...
      </div>
    </template>
  </ClientOnly>
</template>
