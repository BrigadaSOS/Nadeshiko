<script setup lang="ts">
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';

const ApiReference = defineAsyncComponent(() =>
  import('@scalar/api-reference').then((m) => m.ApiReference),
);

const baseUrl = ref('');
onMounted(() => {
  baseUrl.value = window.location.origin;
});

const apiSpecUrl = computed(() => `${baseUrl.value}/nadeshikoapi.yaml`);
</script>

<template>
  <ClientOnly>
    <Suspense>
      <template #default>
        <ApiReference
          :configuration="{
            spec: { url: apiSpecUrl },
          }"
        />
      </template>
      <template #fallback>
        <div class="text-gray-400 text-sm">Loading API reference…</div>
      </template>
    </Suspense>
  </ClientOnly>
</template>

<style>
.dark-mode {
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
