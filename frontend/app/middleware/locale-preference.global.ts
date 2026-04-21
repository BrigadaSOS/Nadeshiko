import { LOCALE_PREFERENCE_COOKIE_NAME, type SupportedLocale } from '~/utils/i18n';
import { splitLocalePrefix } from '~/utils/routes';

const LOCALIZED_PUBLIC_PATHS = ['/', '/about', '/blog', '/dmca', '/media', '/privacy', '/search', '/sentence', '/stats', '/terms-and-conditions'];
const REDIRECTABLE_LOCALES = new Set<SupportedLocale>(['es', 'ja']);
const RESERVED_PREFIXES = ['/admin', '/api', '/collection', '/reports', '/s/', '/user', '/v1', '/_nuxt'];

function isLocalizedPublicPath(path: string): boolean {
  return LOCALIZED_PUBLIC_PATHS.some((candidate) => path === candidate || (candidate !== '/' && path.startsWith(`${candidate}/`)));
}

function isReservedPath(path: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix));
}

export default defineNuxtRouteMiddleware((to) => {
  const { localePrefix, localizedPath } = splitLocalePrefix(to.path);

  if (localePrefix || isReservedPath(localizedPath) || !isLocalizedPublicPath(localizedPath)) {
    return;
  }

  const preferredLocale = useCookie<SupportedLocale | null>(LOCALE_PREFERENCE_COOKIE_NAME, {
    path: '/',
    sameSite: 'lax',
    default: () => null,
  });

  if (!preferredLocale.value || !REDIRECTABLE_LOCALES.has(preferredLocale.value)) {
    return;
  }

  const localePath = useLocalePath();
  const preferredPath = localePath(localizedPath, preferredLocale.value);

  if (!preferredPath || preferredPath === to.path) {
    return;
  }

  return navigateTo({ path: preferredPath, query: to.query, hash: to.hash }, { redirectCode: 302 });
});
