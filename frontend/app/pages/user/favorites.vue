<script setup lang="ts">
/**
 * Legacy redirect: starring moved into the combined `/user/media` tab.
 * See the note in `hide-media.vue` for why this is a page and not a route rule.
 */
definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware(() =>
    navigateTo(useLocalePath()('/user/media'), { replace: true, redirectCode: 301 }),
  ),
});
</script>

<template>
  <div />
</template>
