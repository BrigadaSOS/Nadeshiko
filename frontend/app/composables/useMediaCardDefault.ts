/**
 * Default only the disclosure's initial state; any reader can toggle it. OPEN preserves context
 * for first-time visitors. Account preferences already arrive with the SSR session, so another
 * cookie would add cache fragmentation without improving rendering. Anonymous pages always
 * start OPEN.
 */
export const MEDIA_CARD_DEFAULTS = ['OPEN', 'CLOSED'] as const;
export type MediaCardDefault = (typeof MEDIA_CARD_DEFAULTS)[number];

export const DEFAULT_MEDIA_CARD_DEFAULT: MediaCardDefault = 'OPEN';

export function useMediaCardDefault() {
  const user = userStore();

  const preference = computed<MediaCardDefault>(() => {
    if (!user.isLoggedIn) return DEFAULT_MEDIA_CARD_DEFAULT;
    return user.preferences?.mediaCardDefault === 'CLOSED' ? 'CLOSED' : DEFAULT_MEDIA_CARD_DEFAULT;
  });

  /** The same answer as a boolean, which is the shape the card actually seeds from. */
  const startsOpen = computed(() => preference.value === 'OPEN');

  return { preference, startsOpen };
}
