<script setup lang="ts">
definePageMeta({
  middleware: defineNuxtRouteMiddleware((to) => {
    const raw = to.params.slug;
    const slugParts = Array.isArray(raw) ? raw : raw ? [raw] : [];

    if (slugParts.length === 0) {
      return navigateTo('/user', { replace: true });
    }

    const first = slugParts[0];
    if (first === 'account' || first === 'settings' || first === 'settigns') {
      return navigateTo('/user/settings', { replace: true });
    }
    if (first === 'dashboard' || first === 'reports') {
      return navigateTo(`/user/admin/${slugParts.join('/')}`, { replace: true });
    }

    return navigateTo(`/user/${slugParts.join('/')}`, { replace: true });
  }),
});
</script>

<template>
  <NuxtLayout />
</template>
