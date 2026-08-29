// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';

import ActivityHeatmap from './ActivityHeatmap.vue';
import { HEATMAP_DAYS, HEATMAP_PALETTES, toDayKey } from './activityHelpers';

/**
 * The year-of-activity grid on the account page.
 *
 * Worth a test because its correctness is entirely date arithmetic that nobody
 * can check by looking: the grid is built by walking a cursor from a Sunday-
 * aligned start to today, and every way that goes wrong still renders a
 * plausible-looking wall of squares. A week's offset puts every reader's
 * activity on the wrong weekday row for a year, and nobody files that.
 *
 * The clock is frozen, because a grid that ends "today" is otherwise a different
 * shape every day and any assertion about its size would be flaky by design.
 */
const FROZEN_NOW = new Date(2026, 7, 31, 12, 0); // A Monday.

/** Mounts the heatmap over `raw`, which is `{ dayKey: { TYPE: count } }`. */
function render(
  raw: Record<string, Record<string, number>> = {},
  props: { loading?: boolean; filter?: string | null; selectedDay?: string | null } = {},
) {
  return mount(ActivityHeatmap, {
    props: { raw, loading: false, filter: null, selectedDay: null, ...props },
    global: {
      mocks: { $t: (key: string) => key },
      // A sibling component with its own concerns; rendering it here would be
      // testing two things at once.
      stubs: { UserActivityTypeFilter: true },
    },
  });
}

/**
 * Every day square in the grid, in render order.
 *
 * `[title]` is load-bearing: the weekday-label column shares the `heatmap-cell`
 * class for sizing, so a bare class selector picks up seven label rows as if
 * they were days -- which reads as seven duplicate entries and quietly inflates
 * any count taken from it.
 */
function cells(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll('.heatmap-cell[title]');
}

/** A day key `daysAgo` before the frozen today. */
function dayKeyAgo(daysAgo: number) {
  const date = new Date(FROZEN_NOW);
  date.setDate(date.getDate() - daysAgo);
  return toDayKey(date);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  // `t` carries the count into the tooltip, so the stub has to keep it -- one
  // that returns the bare key makes every square's tooltip identical and any
  // assertion about "how many" pass vacuously.
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count === undefined ? key : `${key}(${params.count})`,
    locale: { value: 'en-US' },
  }));
  vi.stubGlobal('useFormat', () => ({ formatDate: (date: Date) => toDayKey(date) }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the grid', () => {
  test('covers the full year the account page advertises', () => {
    const count = cells(render()).length;

    expect(count).toBeGreaterThanOrEqual(HEATMAP_DAYS);
  });

  test('ends on today, so the most recent square is the reader’s own day', () => {
    const wrapper = render({ [toDayKey(FROZEN_NOW)]: { SEARCH: 3 } });

    const last = cells(wrapper).at(-1);
    expect(last?.attributes('title')).toContain(toDayKey(FROZEN_NOW));
  });

  test('starts on a SUNDAY, which is what keeps every column a whole week', () => {
    // Without the alignment the first column is a partial week and every row
    // below it is off by a day for the entire year. The grid runs from a Sunday
    // to today inclusive, so its length is a whole number of weeks plus however
    // far into this week today is.
    const total = cells(render()).length;

    expect(total % 7).toBe((FROZEN_NOW.getDay() + 1) % 7);
  });

  test('reaches back at least a year before today', () => {
    const wrapper = render({ [dayKeyAgo(HEATMAP_DAYS - 1)]: { SEARCH: 1 } });

    const titles = cells(wrapper).map((cell) => cell.attributes('title'));
    expect(titles.some((title) => title?.includes(dayKeyAgo(HEATMAP_DAYS - 1)))).toBe(true);
  });

  test('never repeats a day', () => {
    // The cursor advances by one; an off-by-one in the month grouping would
    // duplicate the boundary day.
    const wrapper = render();
    const days = cells(wrapper).map((cell) => cell.attributes('title')?.split(':')[0]);

    expect(new Set(days).size).toBe(days.length);
  });

  test('groups the days into months, so the labels line up with the columns', () => {
    const wrapper = render();

    // A year spans thirteen calendar months once the Sunday alignment reaches
    // back past the start of the earliest one.
    expect(wrapper.findAll('.heatmap-month-label').length).toBeGreaterThanOrEqual(12);
  });

  test('shows nothing but a message while the data is still loading', () => {
    // An empty grid and a loading grid look identical otherwise, and the reader
    // reads "you have done nothing this year".
    const wrapper = render({}, { loading: true });

    expect(cells(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain('accountSettings.activity.heatmap.loading');
  });
});

describe('intensity', () => {
  /** The palette class on the square for `count` activities. */
  function classForCount(count: number) {
    const today = toDayKey(FROZEN_NOW);
    const wrapper = render(count > 0 ? { [today]: { SEARCH: count } } : {});
    return cells(wrapper).at(-1)?.classes().join(' ') ?? '';
  }

  test('an empty day gets the lowest level', () => {
    expect(classForCount(0)).toContain(HEATMAP_PALETTES.default[0]!.split(' ')[0]);
  });

  test('gets darker as the day gets busier', () => {
    // The scale is the only thing the grid communicates; a flat one makes the
    // whole component decorative.
    const levels = [0, 1, 3, 6, 20].map(classForCount);

    expect(new Set(levels).size).toBe(5);
  });

  test('a very busy day does not overflow past the darkest level', () => {
    // The level is an index into a five-entry palette; an unclamped one would
    // render a square with no colour class at all.
    expect(classForCount(9999)).toBe(classForCount(20));
  });
});

describe('filtering to one kind of activity', () => {
  const MIXED = { [toDayKey(FROZEN_NOW)]: { SEARCH: 2, ANKI_EXPORT: 5 } };

  test('adds every kind together when nothing is filtered', () => {
    const wrapper = render(MIXED);

    expect(cells(wrapper).at(-1)?.attributes('title')).toContain('(7)');
  });

  test('counts only the chosen kind', () => {
    const wrapper = render(MIXED, { filter: 'SEARCH' });

    expect(cells(wrapper).at(-1)?.attributes('title')).toContain('(2)');
  });

  test('shows a day with none of the chosen kind as empty rather than dropping it', () => {
    // The grid is a calendar; a missing square would shift every day after it.
    const wrapper = render({ [toDayKey(FROZEN_NOW)]: { SEARCH: 4 } }, { filter: 'SHARE' });

    expect(cells(wrapper).at(-1)?.attributes('title')).toContain('(0)');
  });

  test('recolours the grid in the chosen kind’s palette', () => {
    // So the filter is visible at a glance rather than only in the legend.
    const searchColoured = render(MIXED, { filter: 'SEARCH' });
    const exportColoured = render(MIXED, { filter: 'ANKI_EXPORT' });

    expect(cells(searchColoured).at(-1)?.classes()).not.toEqual(cells(exportColoured).at(-1)?.classes());
  });

  test('falls back to the default palette for a kind it has no colour for', () => {
    // A type the backend added before the frontend knew about it.
    const wrapper = render(MIXED, { filter: 'SOMETHING_NEW' });

    expect(cells(wrapper)).not.toHaveLength(0);
  });
});

describe('picking a day', () => {
  test('reports which day was clicked', () => {
    const wrapper = render({ [toDayKey(FROZEN_NOW)]: { SEARCH: 1 } });

    cells(wrapper).at(-1)?.trigger('click');

    expect(wrapper.emitted('select-day')?.[0]).toEqual([toDayKey(FROZEN_NOW)]);
  });

  test('an empty day is still clickable, because "nothing here" is an answer', () => {
    const wrapper = render();

    cells(wrapper).at(-1)?.trigger('click');

    expect(wrapper.emitted('select-day')).toHaveLength(1);
  });

  test('marks the selected day, and only that one', () => {
    const today = toDayKey(FROZEN_NOW);
    const wrapper = render({ [today]: { SEARCH: 1 } }, { selectedDay: today });

    const ringed = cells(wrapper).filter((cell) => cell.classes().some((c) => c.startsWith('ring-')));
    expect(ringed).toHaveLength(1);
    expect(ringed[0]?.attributes('title')).toContain(today);
  });

  test('marks nothing when no day is selected', () => {
    const wrapper = render({ [toDayKey(FROZEN_NOW)]: { SEARCH: 1 } });

    expect(cells(wrapper).filter((cell) => cell.classes().some((c) => c.startsWith('ring-')))).toHaveLength(0);
  });
});
