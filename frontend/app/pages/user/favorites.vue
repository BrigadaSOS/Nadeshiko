<script setup lang="ts">
// Legacy /user/media redirect; see hide-media.vue for the locale-preserving page approach.
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
