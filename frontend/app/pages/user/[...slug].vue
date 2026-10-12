<script setup lang="ts">
import { splitLocalePrefix } from '~/utils/routes';

// Unknown account paths keep their settings fallback instead of hitting the content 404.
definePageMeta({
  middleware: defineNuxtRouteMiddleware((to) => {
    const localePath = useLocalePath();
    const { localizedPath } = splitLocalePrefix(to.path);
    const fallback = localizedPath.startsWith('/user/admin') ? '/user/admin/users' : '/user/settings';
    return navigateTo(localePath(fallback), { replace: true });
  }),
});
</script>

<template>
  <div />
</template>
