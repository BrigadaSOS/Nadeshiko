const STATIC_PAGES = new Set(['/', '/blog', '/media', '/stats', '/stats/words', '/api/v1/docs']);

const DYNAMIC_PAGE_PATTERNS: RegExp[] = [
  /^\/sentence\/[^/]+$/,
  /^\/collection\/[^/]+$/,
  /^\/s\/[^/]+$/,
  /^\/search(\/[^/]+)?$/,
  /^\/admin\//,
  /^\/settings\//,
  /^\/user\//,
];

const SERVER_PREFIXES = ['/v1/', '/media/', '/api/', '/otel-'];
const STATIC_ASSET_PREFIXES = ['/_nuxt/', '/_i18n/', '/__nuxt'];
const STATIC_ASSET_PATHS = ['/up', '/favicon.ico'];

let contentSlugsPromise: Promise<Set<string>> | null = null;

async function loadContentSlugs(): Promise<Set<string>> {
  const storage = useStorage('assets:content');
  const keys = await storage.getKeys('');
  const slugs = new Set<string>();

  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const parts = key.split(':');
    const pathParts = parts.slice(1);
    const slug = pathParts.join('/').replace(/\.md$/, '');
    slugs.add(`/${slug}`);
  }

  return slugs;
}

function isKnownRoute(path: string, slugs: Set<string>): boolean {
  if (STATIC_PAGES.has(path)) return true;
  if (DYNAMIC_PAGE_PATTERNS.some((p) => p.test(path))) return true;
  if (SERVER_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (STATIC_ASSET_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (STATIC_ASSET_PATHS.includes(path)) return true;
  if (slugs.has(path)) return true;

  return false;
}

export default defineEventHandler(async (event) => {
  if (!contentSlugsPromise) {
    contentSlugsPromise = loadContentSlugs();
  }
  const slugs = await contentSlugsPromise;

  const path = (event.path || event.node.req.url || '/').split('?')[0];
  const bot = isBot(event);
  const known = isKnownRoute(path, slugs);

  event.context.isBot = bot;
  event.context.isKnownRoute = known;

  if (bot && !known) {
    setResponseStatus(event, 404);
    return '';
  }
});
