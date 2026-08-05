/**
 * Locale-aware formatting for dates, numbers and relative times.
 *
 * The date and number shapes are registered once in `i18n/i18n.config.ts`; this
 * exposes them so components stop hand-rolling `Intl` calls with their own
 * options, which is how the same "format a date" job ended up implemented ten
 * different ways — including one that never passed a locale at all.
 */
export function useFormat() {
  const { d, n, t, locale } = useI18n();

  /** Thousands-separated integer: 12345 -> "12,345". */
  const formatNumber = (value: number | null | undefined): string => (value == null ? '-' : n(value, 'decimal'));

  /** Ratio as a percentage: 0.42 -> "42%". Pass a 0-1 ratio, not 0-100. */
  const formatPercent = (ratio: number | null | undefined): string => (ratio == null ? '-' : n(ratio, 'percent'));

  const toDate = (value: Date | string | number | null | undefined): Date | null => {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  /**
   * `short` -> 5 Aug 2026, `long` -> 5 August 2026, `dateTime` adds the time.
   * Invalid or missing input renders as "-" rather than "Invalid Date".
   */
  const formatDate = (
    value: Date | string | number | null | undefined,
    style: 'short' | 'long' | 'dateTime' = 'short',
  ): string => {
    const date = toDate(value);
    return date === null ? '-' : d(date, style);
  };

  /**
   * "just now" / "5 minutes ago" / "3 days ago", translated by the browser.
   * Falls back to an absolute date past a month, where "34 days ago" stops
   * being the useful answer.
   */
  const formatRelativeTime = (value: Date | string | number | null | undefined): string => {
    const date = toDate(value);
    if (date === null) return '-';

    const diffMs = date.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / 60_000);

    if (Math.abs(diffMinutes) < 1) {
      // Intl would render "in 0 minutes"; every locale has a better phrase.
      return t('common.justNow');
    }

    const relative = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
    if (Math.abs(diffMinutes) < 60) return relative.format(diffMinutes, 'minute');

    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return relative.format(diffHours, 'hour');

    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) return relative.format(diffDays, 'day');

    return formatDate(date, 'short');
  };

  return { formatNumber, formatPercent, formatDate, formatRelativeTime };
}
