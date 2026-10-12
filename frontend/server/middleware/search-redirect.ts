import {
  buildSentencePath,
  buildWordSearchPath,
  isJunkSearchQuery,
  overEscapedSearchQuery,
  splitLocalePrefix,
  withLocalePrefix,
} from '~/utils/routes';

// Keep legacy redirects permanently for bookmarks and indexed URLs. Normalize junk/multiply-escaped queries
// at the HTTP layer, before the router rewrites the raw path, using 301 to consolidate indexed variants.
export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const { localePrefix, localizedPath } = splitLocalePrefix(url.pathname);

  if (!localizedPath.startsWith('/search')) {
    return;
  }

  // Canonical filter keys win when both current and legacy names are present.
  let normalizedLegacyParams = false;
  const mediaId = url.searchParams.get('mediaId');
  if (mediaId !== null) {
    if (!url.searchParams.has('media')) {
      url.searchParams.set('media', mediaId);
    }
    url.searchParams.delete('mediaId');
    normalizedLegacyParams = true;
  }

  const episodeId = url.searchParams.get('episodeId');
  if (episodeId !== null) {
    if (!url.searchParams.has('episode')) {
      url.searchParams.set('episode', episodeId);
    }
    url.searchParams.delete('episodeId');
    normalizedLegacyParams = true;
  }

  if (url.searchParams.has('uuid')) {
    const uuid = url.searchParams.get('uuid');
    if (uuid === null) {
      return;
    }
    url.searchParams.delete('uuid');
    const remaining = url.searchParams.toString();
    return sendRedirect(
      event,
      `${withLocalePrefix(localePrefix, buildSentencePath(uuid))}${remaining ? `?${remaining}` : ''}`,
      301,
    );
  }

  if (localizedPath === '/search/media' || localizedPath === '/search/media/') {
    const remaining = url.search;
    return sendRedirect(event, `${withLocalePrefix(localePrefix, '/media')}${remaining}`, 301);
  }

  if (localizedPath === '/search/sentence' || localizedPath === '/search/sentence/') {
    const query = url.searchParams.get('query');
    url.searchParams.delete('query');
    const remaining = url.searchParams.toString();
    if (query) {
      return sendRedirect(
        event,
        `${withLocalePrefix(localePrefix, buildWordSearchPath(query))}${remaining ? `?${remaining}` : ''}`,
        301,
      );
    }
    return sendRedirect(event, `${withLocalePrefix(localePrefix, '/search')}${remaining ? `?${remaining}` : ''}`, 301);
  }

  if (localizedPath === '/search' && url.searchParams.has('query')) {
    const query = url.searchParams.get('query');
    if (query === null) {
      return;
    }
    url.searchParams.delete('query');
    const remaining = url.searchParams.toString();
    // Empty queries land on /search, not /search/, avoiding another redirect hop.
    const target = query ? buildWordSearchPath(query) : '/search';
    return sendRedirect(event, `${withLocalePrefix(localePrefix, target)}${remaining ? `?${remaining}` : ''}`, 301);
  }

  // Handle legacy routes before treating their suffix as a query. Inspect the raw request path, not a router-reencoded param.
  if (localizedPath.startsWith('/search/')) {
    const rawQuery = localizedPath.slice('/search/'.length);

    // Judge multiply-escaped queries after unwrapping so junk collapses in one hop.
    const overEscaped = rawQuery ? overEscapedSearchQuery(rawQuery) : null;
    if (overEscaped !== null) {
      const target = isJunkSearchQuery(encodeURIComponent(overEscaped)) ? '/search' : buildWordSearchPath(overEscaped);
      const remaining = url.searchParams.toString();
      return sendRedirect(event, `${withLocalePrefix(localePrefix, target)}${remaining ? `?${remaining}` : ''}`, 301);
    }

    if (rawQuery && isJunkSearchQuery(rawQuery)) {
      return sendRedirect(event, withLocalePrefix(localePrefix, '/search'), 301);
    }
  }

  if (normalizedLegacyParams) {
    const remaining = url.searchParams.toString();
    return sendRedirect(
      event,
      `${withLocalePrefix(localePrefix, localizedPath)}${remaining ? `?${remaining}` : ''}`,
      301,
    );
  }
});
