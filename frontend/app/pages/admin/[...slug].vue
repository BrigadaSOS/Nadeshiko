<script setup lang="ts">
definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const localePath = useLocalePath();
    const newPath = to.path.replace(/\/(es|ja)\/admin/, '/user/admin').replace(/^\/admin/, '/user/admin');
    return navigateTo(localePath(newPath) || localePath('/user/admin/users'), { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
