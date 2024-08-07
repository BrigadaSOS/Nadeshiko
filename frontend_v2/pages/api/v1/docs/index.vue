<script setup>
import { ref, computed, onMounted } from 'vue';
import { ApiReference } from '@scalar/api-reference';

const baseUrl = ref('');

onMounted(() => {
    if (import.meta.client) {
        baseUrl.value = window.location.origin;
    }
});

const apiSpecUrl = computed(() => {
    return `${baseUrl.value}/nadeshikoapi.yaml`;
});
</script>

<template>
    <ClientOnly>
        <ApiReference :configuration="{
            spec: {
                url: apiSpecUrl,
            },
        }" />
    </ClientOnly>
</template>

<style>
.dark-mode {
    --scalar-background-1: #1d1d1d;
    --scalar-background-2: #1a1a1a;
    --scalar-background-3: #272727;
    --scalar-color-1: rgba(255, 255, 255, .9);
    --scalar-color-2: rgba(255, 255, 255, .62);
    --scalar-color-3: rgba(255, 255, 255, .44);
    --scalar-color-accent: #3ea6ff;
    --scalar-background-accent: #3ea6ff1f;
    --scalar-border-color: rgba(255, 255, 255, .1);
}
</style>
