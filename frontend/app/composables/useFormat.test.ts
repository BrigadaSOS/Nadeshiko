import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The one place dates, numbers and relative times are formatted.
 *
 * It exists because the same job had been hand-rolled ten ways, including one
 * that never passed a locale at all -- so what is worth pinning is the handful
 * of decisions it makes ON TOP of `Intl`, none of which `Intl` would make for
 * you:
 *
 *   - missing input renders as "-", never as "Invalid Date" or "NaN", because
 *     these run in table cells where a null date is ordinary;
 *   - zero is a number, not a missing value;
 *   - "in 0 minutes" is replaced by a phrase every locale has;
 *   - and past a month, "34 days ago" stops being the useful answer and an
 *     absolute date takes over.
 *
 * `d` and `n` are the real i18n formatters' contract -- the STYLE NAME is passed
 * through to them, and a test that dropped it would not notice a date rendered
 * in the wrong shape.
 */
const locale = ref('en-US');
const d = vi.fn((value: Date, style: string) => `${style}:${value.toISOString()}`);
const n = vi.fn((value: number, style: string) => `${style}:${value}`);

vi.stubGlobal('useI18n', () => ({ d, n, t: (key: string) => key, locale }));

import { useFormat } from './useFormat';

/** Frozen, so "5 minutes ago" is the same five minutes on every run. */
const NOW = new Date('2026-08-31T12:00:00Z');

/** A moment `minutes` from the frozen now; negative is in the past. */
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  locale.value = 'en-US';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('numbers', () => {
  test('are thousands-separated by the locale, not by hand', () => {
    expect(useFormat().formatNumber(12345)).toBe('decimal:12345');
  });

  test('ZERO is a number, not a missing value', () => {
    // A corpus with no results for a title is a fact worth stating; "-" reads
    // as "we did not look".
    expect(useFormat().formatNumber(0)).toBe('decimal:0');
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('%s renders as a dash', (_name, value) => {
    expect(useFormat().formatNumber(value)).toBe('-');
  });
});

describe('percentages', () => {
  test('take a RATIO, not a number already multiplied by a hundred', () => {
    // Passing 42 here renders "4,200%", which has happened.
    expect(useFormat().formatPercent(0.42)).toBe('percent:0.42');
  });

  test('zero percent is a percentage', () => {
    expect(useFormat().formatPercent(0)).toBe('percent:0');
  });

  test('a missing ratio renders as a dash', () => {
    expect(useFormat().formatPercent(null)).toBe('-');
  });
});

describe('dates', () => {
  test('default to the short shape', () => {
    expect(useFormat().formatDate(NOW)).toBe(`short:${NOW.toISOString()}`);
  });

  test.each(['short', 'long', 'dateTime', 'dateUtc'] as const)('pass the %s shape through to i18n', (style) => {
    // The shapes are registered once in the i18n config; picking them apart
    // here is how the ten hand-rolled versions started.
    useFormat().formatDate(NOW, style);

    expect(d).toHaveBeenCalledWith(NOW, style);
  });

  test('accept a string, which is what every API payload carries', () => {
    expect(useFormat().formatDate('2026-08-31T12:00:00Z')).toBe(`short:${NOW.toISOString()}`);
  });

  test('accept a timestamp', () => {
    expect(useFormat().formatDate(NOW.getTime())).toBe(`short:${NOW.toISOString()}`);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('render %s as a dash', (_name, value) => {
    expect(useFormat().formatDate(value)).toBe('-');
  });

  test('render an UNPARSEABLE date as a dash, never as "Invalid Date"', () => {
    // These land in table cells; a row reading "Invalid Date" is a bug report.
    expect(useFormat().formatDate('not a date')).toBe('-');
  });

  test('do not hand an invalid date to the formatter at all', () => {
    // `Intl` throws on one, which would take the whole page down rather than
    // spoil one cell.
    useFormat().formatDate('not a date');

    expect(d).not.toHaveBeenCalled();
  });
});

describe('relative times', () => {
  const relative = (minutes: number) => useFormat().formatRelativeTime(at(minutes));

  test('just now, rather than "in 0 minutes"', () => {
    // Which is what `Intl` renders, and every locale has a better phrase.
    expect(relative(0)).toBe('common.justNow');
  });

  test('a few seconds either side is still just now', () => {
    expect(useFormat().formatRelativeTime(new Date(NOW.getTime() - 20_000))).toBe('common.justNow');
    expect(useFormat().formatRelativeTime(new Date(NOW.getTime() + 20_000))).toBe('common.justNow');
  });

  test('minutes, once there is a whole one to report', () => {
    expect(relative(-5)).toBe('5 minutes ago');
  });

  test('and counts forward for something still to come', () => {
    // Announcement schedules and cache expiries are both in the future.
    expect(relative(5)).toBe('in 5 minutes');
  });

  test('switches to hours at the hour, not at ninety minutes', () => {
    expect(relative(-59)).toBe('59 minutes ago');
    expect(relative(-60)).toBe('1 hour ago');
  });

  test('switches to days at the day', () => {
    expect(relative(-23 * 60)).toBe('23 hours ago');
    expect(relative(-24 * 60)).toBe('yesterday');
  });

  test('gives up on relative time after a month', () => {
    // "34 days ago" is a number the reader has to do arithmetic on; a date is
    // the useful answer by then.
    expect(relative(-29 * 24 * 60)).toBe('29 days ago');
    expect(relative(-30 * 24 * 60)).toBe(`short:${at(-30 * 24 * 60).toISOString()}`);
  });

  test('speaks the reader’s language, not the browser’s default', () => {
    // The bug this composable was written for: an English relative time under
    // a Spanish page.
    locale.value = 'es-ES';

    expect(relative(-5)).toBe('hace 5 minutos');
  });

  test('a missing time renders as a dash', () => {
    expect(useFormat().formatRelativeTime(null)).toBe('-');
  });

  test('an unparseable one does too', () => {
    expect(useFormat().formatRelativeTime('not a date')).toBe('-');
  });
});
