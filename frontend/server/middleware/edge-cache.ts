const NO_CACHE_PREFIXES = ['/api/', '/v1/', '/otel-collector', '/up', '/media/'];
const SESSION_COOKIE = 'nadeshiko.session_token';

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;

  if (NO_CACHE_PREFIXES.some((p) => path.startsWith(p)) || event.method !== 'GET') {
    setHeader(event, 'Cache-Control', 'no-store');
    return;
  }

  const cookies = getHeader(event, 'cookie') || '';
  const hasSession =
    cookies.includes(SESSION_COOKIE) ||
    cookies.includes(`__Secure-${SESSION_COOKIE}`);

  if (hasSession) {
    setHeader(event, 'Cache-Control', 'no-store');
    return;
  }

  setHeader(event, 'Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200, max-age=0');
});
