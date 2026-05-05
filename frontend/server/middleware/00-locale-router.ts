import { LOCALE_PREFERENCE_COOKIE_NAME, SUPPORTED_LOCALES, type SupportedLocale } from '~/utils/i18n';

const RESERVED_PREFIXES = [
  '/_nuxt/',
  '/api/',
  '/v1/',
  '/__sitemap__',
  '/sitemap',
  '/docs/',
  '/.well-known/',
  '/media/',
];

const RESERVED_EXACT = new Set(['/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']);

function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value !== null && value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function getLocalePrefix(path: string): SupportedLocale | null {
  for (const locale of SUPPORTED_LOCALES) {
    if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return locale;
  }
  return null;
}

function isReservedPath(path: string): boolean {
  if (RESERVED_EXACT.has(path)) return true;
  if (RESERVED_PREFIXES.some((p) => path.startsWith(p))) return true;
  // Files at root: /github-xxx.png, /logo-xxx.webp, /sitemap-en.xml, etc.
  if (/^\/[^/]+\.[a-zA-Z0-9]+$/.test(path)) return true;
  return false;
}

function pickLocaleFromAcceptLanguage(header: string | undefined): SupportedLocale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const quality = qParam ? Number.parseFloat(qParam.split('=')[1] ?? '1') : 1;
      return { lang: (tag ?? '').split('-')[0]?.toLowerCase() ?? '', quality: Number.isNaN(quality) ? 0 : quality };
    })
    .sort((a, b) => b.quality - a.quality);
  for (const { lang } of candidates) {
    if (isSupportedLocale(lang)) return lang;
  }
  return null;
}

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (isReservedPath(path)) return;
  if (getLocalePrefix(path)) return;

  const search = url.search;

  if (path === '/') {
    const cookieRaw = getCookie(event, LOCALE_PREFERENCE_COOKIE_NAME);
    const fromCookie = isSupportedLocale(cookieRaw) ? cookieRaw : null;
    const fromHeader = pickLocaleFromAcceptLanguage(getRequestHeader(event, 'accept-language'));
    const target: SupportedLocale = fromCookie ?? fromHeader ?? 'en';
    setHeader(event, 'Cache-Control', 'private, no-store');
    return sendRedirect(event, `/${target}${search}`, 302);
  }

  setHeader(event, 'Cache-Control', 'public, max-age=31536000');
  return sendRedirect(event, `/en${path}${search}`, 301);
});
