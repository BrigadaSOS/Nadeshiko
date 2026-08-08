import { HIRAGANA_COOKIE } from '#shared/utils/preferenceCookies';

export type FuriganaVisibilityMode = 'show' | 'spoiler' | 'hidden';

// Named in `shared/utils/preferenceCookies.ts` because this cookie changes what
// SSR renders, which makes it part of the cache key for anonymous HTML.
const COOKIE_NAME = HIRAGANA_COOKIE;

function isValidMode(value: unknown): value is FuriganaVisibilityMode {
  return value === 'show' || value === 'spoiler' || value === 'hidden';
}

function nextMode(current: FuriganaVisibilityMode): FuriganaVisibilityMode {
  if (current === 'show') return 'spoiler';
  if (current === 'spoiler') return 'hidden';
  return 'show';
}

export function useHiraganaVisibility() {
  const { state: furiganaMode, set } = useCookiePreference<FuriganaVisibilityMode>(COOKIE_NAME, 'hiragana-visibility', {
    parse: (raw) => (isValidMode(raw) ? raw : 'show'),
    // 'show' is the default, so it is stored as an absent cookie.
    serialize: (mode) => (mode === 'show' ? null : mode),
  });

  const cycleFuriganaMode = () => {
    set(nextMode(furiganaMode.value));
  };

  return { furiganaMode, cycleFuriganaMode };
}
