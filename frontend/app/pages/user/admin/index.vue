<script setup lang="ts">
definePageMeta({
  middleware: defineNuxtRouteMiddleware(() => {
    const localePath = useLocalePath();
    return navigateTo(localePath('/user/admin/users'), { replace: true });
  }),
});
</script>

<template>
  <div />
</template>
