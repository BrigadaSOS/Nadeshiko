import { buildSentencePath, splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

const CANONICAL_REWRITES: Record<string, (query: Record<string, string>) => string> = {
  '/search/sentence': (q) => (q.query ? buildSentencePath(q.query) : '/search/sentence'),
};

const CANONICAL_PARAMS: Record<string, string[]> = {
  '/search': ['media', 'episode', 'category'],
  '/media': ['query', 'category'],
};

export default defineNuxtPlugin(() => {
  const route = useRoute();
  const { url: siteUrl } = useSiteConfig();

  useHead({
    link: () => {
      const path = route.path;
      const { localePrefix, localizedPath } = splitLocalePrefix(path);

      const rewrite = CANONICAL_REWRITES[localizedPath];
      if (rewrite) {
        const queryMap: Record<string, string> = {};
        for (const [k, v] of Object.entries(route.query)) {
          if (typeof v === 'string') queryMap[k] = v;
        }
        return [{ rel: 'canonical', href: `${siteUrl}${withLocalePrefix(localePrefix, rewrite(queryMap))}` }];
      }

      const allowedParams =
        Object.entries(CANONICAL_PARAMS).find(([prefix]) => localizedPath.startsWith(prefix))?.[1] ?? [];

      const params = new URLSearchParams();
      for (const key of allowedParams) {
        const value = route.query[key];
        if (typeof value === 'string' && value) {
          params.set(key, value);
        }
      }

      const query = params.toString();
      const href = `${siteUrl}${path}${query ? `?${query}` : ''}`;

      return [{ rel: 'canonical', href }];
    },
  });
});
