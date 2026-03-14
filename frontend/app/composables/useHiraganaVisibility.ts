const COOKIE_NAME = 'nd_hiragana';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function useHiraganaVisibility() {
  const cookie = useCookie<string | null>(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    encode: String,
    decode: String,
  });

  const showHiragana = useState<boolean>('hiragana-visibility', () => cookie.value === 'show');

  if (import.meta.server) {
    showHiragana.value = cookie.value === 'show';
  }

  const toggleHiragana = () => {
    showHiragana.value = !showHiragana.value;
    cookie.value = showHiragana.value ? 'show' : null;
  };

  return { showHiragana, toggleHiragana };
}
