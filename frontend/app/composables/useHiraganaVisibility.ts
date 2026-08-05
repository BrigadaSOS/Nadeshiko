export type FuriganaVisibilityMode = 'show' | 'spoiler' | 'hidden';

const COOKIE_NAME = 'nd_hiragana';

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
