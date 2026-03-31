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

      const allowedParams = Object.entries(CANONICAL_PARAMS).find(([prefix]) => path.startsWith(prefix))?.[1] ?? [];

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
