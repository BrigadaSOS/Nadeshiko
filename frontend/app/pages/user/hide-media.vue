<script setup lang="ts">
// Redirect bookmarked hide-media URLs to the combined media tab, not general settings.
// A page (rather than routeRules) preserves the incoming locale prefix in the 301 target.
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
