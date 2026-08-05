<script setup lang="ts">
import { splitLocalePrefix } from '~/utils/routes';

// Every real settings tab has its own page file; this only catches leftovers
// (old bookmarks, typos) and keeps the pre-existing "bounce to the first tab"
// behaviour instead of 404ing through the site-wide content catch-all.
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
