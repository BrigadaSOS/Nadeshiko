export type TooltipReadingMode = 'hiragana' | 'katakana' | 'romaji' | 'hidden';

const VALID_MODES = new Set<string>(['hiragana', 'katakana', 'romaji', 'hidden']);
const COOKIE_NAME = 'nd_tooltip_reading';

export function useTooltipReadingVisibility() {
  const { state: tooltipReadingMode, set: setTooltipReadingMode } = useCookiePreference<TooltipReadingMode>(
    COOKIE_NAME,
    'tooltip-reading-mode',
    {
      parse: (raw) => (VALID_MODES.has(raw ?? '') ? (raw as TooltipReadingMode) : 'hiragana'),
      // 'hiragana' is the default, so it is stored as an absent cookie.
      serialize: (mode) => (mode === 'hiragana' ? null : mode),
    },
  );

  return { tooltipReadingMode, setTooltipReadingMode };
}
