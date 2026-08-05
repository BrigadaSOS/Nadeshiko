<script setup lang="ts">
import { preferredLocalePath } from '~/middleware/locale-preference';
import { splitLocalePrefix } from '~/utils/routes';

/**
 * Legacy redirect for the old `/settings/*` account area.
 *
 * These paths were the real page tree before the account pages moved under
 * `/user/*`, so bookmarks and old links still point here. Without this they fall
 * through to the site-wide markdown catch-all and 404. Mirrors the equivalent
 * `/admin/*` redirect in pages/admin/[...slug].vue.
 *
 * `settigns` is a typo that was live long enough to be linked; it is cheaper to
 * keep forwarding it than to work out who still has it saved.
 */
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
