export type TooltipReadingMode = 'hiragana' | 'katakana' | 'romaji' | 'hidden';

const VALID_MODES = new Set<string>(['hiragana', 'katakana', 'romaji', 'hidden']);
const COOKIE_NAME = 'nd_tooltip_reading';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function useTooltipReadingVisibility() {
  const cookie = useCookie<string | null>(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    encode: String,
    decode: String,
  });

  const defaultMode = (): TooltipReadingMode =>
    VALID_MODES.has(cookie.value ?? '') ? (cookie.value as TooltipReadingMode) : 'hiragana';

  const tooltipReadingMode = useState<TooltipReadingMode>('tooltip-reading-mode', defaultMode);

  if (import.meta.server) {
    tooltipReadingMode.value = defaultMode();
  }

  const setTooltipReadingMode = (mode: TooltipReadingMode) => {
    tooltipReadingMode.value = mode;
    cookie.value = mode === 'hiragana' ? null : mode;
  };

  return { tooltipReadingMode, setTooltipReadingMode };
}
