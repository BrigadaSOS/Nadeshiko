<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import '@scalar/api-reference/style.css';

const ScalarApiReference = defineAsyncComponent(() =>
  import('@scalar/api-reference').then((module) => {
    const component = module.ScalarApiReference || module.ApiReference || module.default;
    return component;
  })
);

const runtimeConfig = useRuntimeConfig();

const config = {
  url: `${runtimeConfig.public.baseURLBackend}/api/v1/openapi.yaml`,
  theme: 'deepSpace',
  layout: 'modern',
  darkMode: true,
};
</script>

<template>
  <ClientOnly>
    <div class="scalar-container">
      <Suspense>
        <template #default>
          <ScalarApiReference :configuration="config" />
        </template>
        <template #fallback>
          <div class="flex items-center justify-center p-10 text-gray-500">
            Loading...
          </div>
        </template>
      </Suspense>
    </div>
  </ClientOnly>
</template>

<style>
/* ... tus estilos anteriores ... */
.scalar-container, .dark-mode {
  --scalar-background-1: #1d1d1d;
  --scalar-background-2: #1a1a1a;
  --scalar-background-3: #272727;
  --scalar-color-1: rgba(255, 255, 255, 0.9);
  --scalar-color-2: rgba(255, 255, 255, 0.62);
  --scalar-color-3: rgba(255, 255, 255, 0.44);
  --scalar-color-accent: #3ea6ff;
  --scalar-background-accent: #3ea6ff1f;
  --scalar-border-color: rgba(255, 255, 255, 0.1);
}
</style>