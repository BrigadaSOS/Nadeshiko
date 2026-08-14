<script setup lang="ts">
/**
 * Legacy redirect: hiding moved into the combined `/user/media` tab.
 *
 * A page file rather than a `routeRules` entry, because these paths are locale
 * prefixed and the target has to keep the prefix the reader arrived on --
 * the same reason `/s/[id]` and the legacy `/settings/*` tree redirect this way.
 *
 * 301 rather than a bounce to the settings catch-all: this URL was linked from
 * the account menu for long enough to be bookmarked, and `user/[...slug].vue`
 * would land those bookmarks on the general settings tab instead of the page
 * that now holds what they were looking for.
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
