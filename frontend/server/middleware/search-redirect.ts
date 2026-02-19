/**
 * Backward-compatibility redirects (301 Permanent).
 *
 * The URL scheme changed in Feb 2026:
 *   /search/sentence?query=彼女  →  /search/彼女       (path-based search)
 *   /search/sentence             →  /search             (empty search landing)
 *   /search?query=term           →  /search/term        (query-param form)
 *   /search/sentence?uuid=abc    →  /sentence/abc       (individual sentence)
 *   /search?uuid=abc             →  /sentence/abc       (individual sentence)
 *   /search/media                →  /media              (media browse)
 *   /search/media?query=steins   →  /media?query=steins (media browse with query)
 *
 * These redirects MUST stay in place permanently so that bookmarks,
 * external links, and Google's cached URLs continue to work.
 */
export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  // Only process /search paths — skip everything else early
  if (!path.startsWith('/search')) {
    return;
  }

  // Canonicalize legacy filter query params used by older links:
  // - mediaId -> media
  // - episodeId -> episode
  // Keep canonical keys when both exist.
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

  // UUID redirects on search pages: /search/sentence?uuid=abc or /search?uuid=abc → /sentence/abc
  if (url.searchParams.has('uuid')) {
    const uuid = url.searchParams.get('uuid');
    if (uuid === null) {
      return;
    }
    url.searchParams.delete('uuid');
    const remaining = url.searchParams.toString();
    return sendRedirect(event, `/sentence/${uuid}${remaining ? `?${remaining}` : ''}`, 301);
  }

  // /search/media → /media  (preserves all query params)
  if (path === '/search/media' || path === '/search/media/') {
    const remaining = url.search;
    return sendRedirect(event, `/media${remaining}`, 301);
  }

  // /search/sentence?query=term → /search/term
  // /search/sentence             → /search
  // /search/sentence?category=anime → /search?category=anime
  if (path === '/search/sentence' || path === '/search/sentence/') {
    const query = url.searchParams.get('query');
    url.searchParams.delete('query');
    const remaining = url.searchParams.toString();
    if (query) {
      return sendRedirect(event, `/search/${encodeURIComponent(query)}${remaining ? `?${remaining}` : ''}`, 301);
    }
    return sendRedirect(event, `/search${remaining ? `?${remaining}` : ''}`, 301);
  }

  // /search?query=term → /search/term  (preserves other query params like category, sort)
  if (path === '/search' && url.searchParams.has('query')) {
    const query = url.searchParams.get('query');
    if (query === null) {
      return;
    }
    url.searchParams.delete('query');
    const remaining = url.searchParams.toString();
    return sendRedirect(event, `/search/${encodeURIComponent(query)}${remaining ? `?${remaining}` : ''}`, 301);
  }

  if (normalizedLegacyParams) {
    const remaining = url.searchParams.toString();
    return sendRedirect(event, `${path}${remaining ? `?${remaining}` : ''}`, 301);
  }
});
