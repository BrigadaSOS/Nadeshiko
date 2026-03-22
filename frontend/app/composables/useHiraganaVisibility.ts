export type FuriganaVisibilityMode = 'show' | 'spoiler' | 'hidden';

const COOKIE_NAME = 'nd_hiragana';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function isValidMode(value: unknown): value is FuriganaVisibilityMode {
  return value === 'show' || value === 'spoiler' || value === 'hidden';
}

function nextMode(current: FuriganaVisibilityMode): FuriganaVisibilityMode {
  if (current === 'show') return 'spoiler';
  if (current === 'spoiler') return 'hidden';
  return 'show';
}

export function useHiraganaVisibility() {
  const cookie = useCookie<string | null>(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    encode: String,
    decode: String,
  });

  const furiganaMode = useState<FuriganaVisibilityMode>('hiragana-visibility', () => {
    return isValidMode(cookie.value) ? cookie.value : 'show';
  });

  if (import.meta.server) {
    furiganaMode.value = isValidMode(cookie.value) ? cookie.value : 'show';
  }

  const cycleFuriganaMode = () => {
    furiganaMode.value = nextMode(furiganaMode.value);
    cookie.value = furiganaMode.value === 'show' ? null : furiganaMode.value;
  };

  return { furiganaMode, cycleFuriganaMode };
}
