<script setup lang="ts">
import { useLocalePreference } from '~/composables/useLocalePreference';
import { splitLocalePrefix } from '~/utils/routes';

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const localePath = useLocalePath();
    const { preferredLocale } = useLocalePreference();
    const { localizedPath } = splitLocalePrefix(to.path);
    const newPath = localizedPath.replace(/^\/admin/, '/user/admin');
    const targetPath = preferredLocale.value ? localePath(newPath, preferredLocale.value) : localePath(newPath);

    return navigateTo(targetPath || localePath('/user/admin/users'), { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
