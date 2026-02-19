<script setup lang="ts">
definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const newPath = to.path.replace(/^\/admin/, '/user/admin');
    return navigateTo(newPath || '/user/admin/dashboard', { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
