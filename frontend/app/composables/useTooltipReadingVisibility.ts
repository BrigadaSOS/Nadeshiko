import { TOOLTIP_READING_COOKIE } from '#shared/utils/preferenceCookies';

export type TooltipReadingMode = 'hiragana' | 'katakana' | 'romaji' | 'hidden';

const VALID_MODES = new Set<string>(['hiragana', 'katakana', 'romaji', 'hidden']);
// See `shared/utils/preferenceCookies.ts`: read during SSR, so it is a cache key.
const COOKIE_NAME = TOOLTIP_READING_COOKIE;

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
