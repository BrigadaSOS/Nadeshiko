<script setup lang="ts">
definePageMeta({
  middleware: defineNuxtRouteMiddleware(() => {
    const localePath = useLocalePath();
    return navigateTo(localePath('/user/settings'), { replace: true });
  }),
});
</script>

<template>
  <div />
</template>
