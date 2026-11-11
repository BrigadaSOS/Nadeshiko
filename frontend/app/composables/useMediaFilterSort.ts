import { MEDIA_SORT_COOKIE } from '#shared/utils/preferenceCookies';
import { useCookiePreference } from '~/composables/useCookiePreference';
import { DEFAULT_MEDIA_SORT_MODE, MEDIA_SORT_MODES, type MediaSortMode } from '~/utils/mediaFilterSort';

const isMediaSortMode = (value: string | null): value is MediaSortMode =>
  !!value && (MEDIA_SORT_MODES as readonly string[]).includes(value);

/**
 * How the search media filter orders its titles: by name, or by how many
 * sentences the query found in each. A cookie rather than an account setting,
 * like the other reader preferences: it works signed out, and the server reads
 * it so the list is rendered in the reader's order instead of reshuffling on
 * hydration.
 */
export function useMediaFilterSort() {
  const { state, set } = useCookiePreference<MediaSortMode>(MEDIA_SORT_COOKIE, 'media-filter-sort', {
    parse: (raw) => (isMediaSortMode(raw) ? raw : DEFAULT_MEDIA_SORT_MODE),
    // The default is the absence of a choice, so it clears rather than writes.
    serialize: (value) => (value === DEFAULT_MEDIA_SORT_MODE ? null : value),
  });

  return { mode: state, setMode: set };
}
