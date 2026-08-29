import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  ACTIVITY_TYPES,
  HEATMAP_PALETTES,
  activityTypeClass,
  activityTypeLabel,
  activityTypeMutedClass,
  formatDayLabel,
  sinceForRange,
  startOfDay,
  toDayKey,
} from './activityHelpers';

/**
 * The date arithmetic behind the activity heatmap.
 *
 * All of it is LOCAL-TIME on purpose, and that is the whole reason it is worth
 * pinning: a reader's activity belongs to the day they experienced, not the day
 * it was in UTC. Reaching for `toISOString()` here -- the obvious way to get a
 * `YYYY-MM-DD` -- silently shifts every evening's activity into tomorrow for
 * anyone east of UTC and every morning's into yesterday for anyone west, and the
 * heatmap still renders perfectly.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe('toDayKey', () => {
  test('formats a date as YYYY-MM-DD', () => {
    expect(toDayKey(new Date(2026, 7, 31))).toBe('2026-08-31');
  });

  test('pads single-digit months and days, so keys sort as text', () => {
    // The heatmap groups and compares these as strings.
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('reads the LOCAL day, not the UTC one', () => {
    // 23:30 local on the 31st is already the 1st in UTC for anyone east of it.
    // Using the UTC date would move that evening's activity to the next square.
    const lateEvening = new Date(2026, 7, 31, 23, 30);

    expect(toDayKey(lateEvening)).toBe('2026-08-31');
  });

  test('an early morning stays on its own day too', () => {
    expect(toDayKey(new Date(2026, 7, 31, 0, 15))).toBe('2026-08-31');
  });

  test('handles a leap day', () => {
    expect(toDayKey(new Date(2024, 1, 29))).toBe('2024-02-29');
  });
});

describe('startOfDay', () => {
  test('drops the time', () => {
    const noon = new Date(2026, 7, 31, 12, 34, 56, 789);

    expect(startOfDay(noon).getHours()).toBe(0);
    expect(startOfDay(noon).getMinutes()).toBe(0);
    expect(startOfDay(noon).getSeconds()).toBe(0);
    expect(startOfDay(noon).getMilliseconds()).toBe(0);
  });

  test('keeps the calendar day it was given', () => {
    expect(toDayKey(startOfDay(new Date(2026, 7, 31, 23, 59)))).toBe('2026-08-31');
  });

  test('does not mutate its argument', () => {
    // The heatmap walks a cursor date; mutating in place would move it.
    const original = new Date(2026, 7, 31, 12, 0);

    startOfDay(original);

    expect(original.getHours()).toBe(12);
  });
});

describe('sinceForRange', () => {
  test('asks for no lower bound at all on the full range', () => {
    // Not "a very early date": an absent bound is what lets the API skip the
    // filter entirely.
    expect(sinceForRange('all')).toBeUndefined();
  });

  test.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s reaches back %d days', (range, days) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 31, 12, 0));

    const expected = new Date(2026, 7, 31);
    expected.setDate(expected.getDate() - days);
    expect(sinceForRange(range)).toBe(toDayKey(expected));
  });

  test('crosses a month boundary correctly', () => {
    // `setDate` with a negative result rolls the month back; doing the
    // arithmetic on the day number alone would produce `2026-08--2`.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12, 0));

    expect(sinceForRange('7d')).toBe('2026-08-27');
  });

  test('falls back to a week for a range it does not know', () => {
    // Rather than an undefined bound, which would silently widen the query to
    // everything the account has ever done.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 31, 12, 0));

    expect(sinceForRange('nonsense' as never)).toBe('2026-08-24');
  });
});

describe('formatDayLabel', () => {
  test('reads the key as a local date, not a UTC instant', () => {
    // `new Date('2026-08-31')` is midnight UTC and renders as the 30th for
    // anyone west of it; the explicit `T00:00:00` is what avoids that.
    expect(formatDayLabel('2026-08-31', 'en-US')).toContain('31');
  });

  test('names the day and month in the reader’s language', () => {
    const spanish = formatDayLabel('2026-08-31', 'es-ES');

    expect(spanish).not.toBe(formatDayLabel('2026-08-31', 'en-US'));
  });
});

describe('activity type labels', () => {
  test.each(ACTIVITY_TYPES)('%s is translated', (type) => {
    expect(activityTypeLabel(type, (key) => key)).toBe(`accountSettings.activity.types.${type}`);
  });

  test('an unknown type is shown as itself rather than as a missing key', () => {
    // A type added by the backend before the frontend knows about it renders
    // as `SOMETHING_NEW`, not as `accountSettings.activity.types.SOMETHING_NEW`.
    expect(activityTypeLabel('SOMETHING_NEW', (key) => key)).toBe('SOMETHING_NEW');
  });
});

describe('activity type styling', () => {
  test.each(ACTIVITY_TYPES)('%s has its own colour', (type) => {
    expect(activityTypeClass(type)).not.toBe(activityTypeClass('UNKNOWN'));
  });

  test('every type is visually distinct from the others', () => {
    // They sit side by side in the filter row; two sharing a colour makes the
    // filter unreadable.
    const classes = ACTIVITY_TYPES.map(activityTypeClass);

    expect(new Set(classes).size).toBe(classes.length);
  });

  test.each([
    ['activityTypeClass', activityTypeClass],
    ['activityTypeMutedClass', activityTypeMutedClass],
  ])('%s falls back to a neutral style for an unknown type', (_name, style) => {
    expect(style('SOMETHING_NEW')).toBeTruthy();
  });

  test('the muted style differs from the active one, which is what shows selection', () => {
    for (const type of ACTIVITY_TYPES) {
      expect(activityTypeMutedClass(type)).not.toBe(activityTypeClass(type));
    }
  });
});

describe('the heatmap palettes', () => {
  test('every activity type has one, so a filtered heatmap is never colourless', () => {
    for (const type of ACTIVITY_TYPES) {
      expect(HEATMAP_PALETTES[type]).toBeDefined();
    }
  });

  test('each palette has five levels, which is what the intensity scale assumes', () => {
    for (const palette of Object.values(HEATMAP_PALETTES)) {
      expect(palette).toHaveLength(5);
    }
  });

  test('every palette starts on the same empty square', () => {
    // A day with no activity should look identical whichever filter is on;
    // otherwise switching filters appears to change the past.
    const empties = Object.values(HEATMAP_PALETTES).map((palette) => palette[0]);

    expect(new Set(empties).size).toBe(1);
  });
});
