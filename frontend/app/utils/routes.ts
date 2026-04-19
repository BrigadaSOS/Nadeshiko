const LOCALE_PREFIXES = ['/es', '/ja'] as const;

export function splitLocalePrefix(path: string): { localePrefix: string; localizedPath: string } {
  const localePrefix = LOCALE_PREFIXES.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? '';
  const localizedPath = localePrefix ? path.slice(localePrefix.length) || '/' : path;
  return { localePrefix, localizedPath };
}

export function withLocalePrefix(localePrefix: string, path: string): string {
  if (!localePrefix) return path;
  return path === '/' ? localePrefix : `${localePrefix}${path}`;
}

export function localizePath(currentPath: string, path: string): string {
  return withLocalePrefix(splitLocalePrefix(currentPath).localePrefix, path);
}

export function buildWordSearchPath(word: string): string {
  return `/search/${encodeURIComponent(word)}`;
}

export function buildMediaSearchPath(mediaPublicId: string, episode?: number | string | null): string {
  const params = new URLSearchParams({ media: mediaPublicId });
  if (episode !== undefined && episode !== null && `${episode}` !== '') {
    params.set('episode', `${episode}`);
  }
  return `/search?${params.toString()}`;
}

export function buildSentencePath(segmentPublicId: string): string {
  return `/sentence/${segmentPublicId}`;
}
