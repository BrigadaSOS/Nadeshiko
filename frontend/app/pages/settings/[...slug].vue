<script setup lang="ts">
import { preferredLocalePath } from '~/middleware/locale-preference';
import { splitLocalePrefix } from '~/utils/routes';

// Preserve old /settings/* bookmarks after the move to /user/*, including the
// historically linked "settigns" typo. Mirrors the legacy /admin/* redirect.
function legacyTarget(slugParts: string[]): string {
  if (slugParts.length === 0) return '/user';

  const [first] = slugParts;
  if (first === 'account' || first === 'settings' || first === 'settigns') return '/user/settings';
  if (first === 'dashboard') return '/user/admin/users';
  if (first === 'reports') return `/user/admin/${slugParts.join('/')}`;

  return `/user/${slugParts.join('/')}`;
}

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const { localizedPath } = splitLocalePrefix(to.path);
    const slugParts = localizedPath
      .replace(/^\/settings\/?/, '')
      .split('/')
      .filter(Boolean);

    return navigateTo(preferredLocalePath(legacyTarget(slugParts)), { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
