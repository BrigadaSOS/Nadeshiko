<script setup lang="ts">
const { $ScalarApiReference } = useNuxtApp()

const config = useRuntimeConfig();
const baseURLBackend = config.public.baseURLBackend as string || 'https://api.brigadasos.xyz';

const apiReferenceConfig = {
  url: `${baseURLBackend}/api/docs/openapi.yaml`,
  theme: 'deepSpace',
  layout: 'modern',
  darkMode: true,
  hiddenTags: ['Auth', 'AuthJwt', 'User', 'Admin'],
}
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
