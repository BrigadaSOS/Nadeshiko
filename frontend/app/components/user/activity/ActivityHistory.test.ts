// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The activity timeline on the account page.
 *
 * Two things it decides. Consecutive identical entries are GROUPED into one row
 * with a count -- replaying a clip five times is one thing a reader did, not five
 * rows -- and the grouping key includes the title a search was scoped to,
 * because "the same query across everything" and "the same query inside one
 * show" are different searches.
 *
 * And the Japanese it shows comes back with the search highlighting still in it,
 * so the tags are stripped REPEATEDLY until the text stops changing: a single
 * pass turns `<<b>b>text` into `<b>text`, which then renders as markup.
 */
const push = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useFormat', () => ({ formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRouter', () => ({ push }));

import ActivityHistory from './ActivityHistory.vue';

let nextId = 1;
const activity = (over: Record<string, unknown> = {}) => ({
  id: nextId++,
  activityType: 'SEGMENT_PLAY',
  segmentPublicId: 's1',
  mediaPublicId: 'm1',
  mediaName: 'Bocchi',
  japaneseText: '猫',
  searchQuery: null,
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

function render(activities: ReturnType<typeof activity>[]) {
  const wrapper = mount(ActivityHistory, {
    props: {
      activities,
      loading: false,
      loadingMore: false,
      hasMore: false,
      selectedDay: null,
      typeFilter: null,
      clearingDay: false,
      deletingIds: new Set<number>(),
    } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        UiBaseIcon: true,
        UserActivityTypeFilter: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** Rows are table rows, not list items. */
const rows = (w: ReturnType<typeof render>) => w.findAll('tbody tr');

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('grouping repeats', () => {
  test('three plays of one clip are one row', async () => {
    // Replaying a clip is one thing the reader did, not three.
    const wrapper = render([activity(), activity(), activity()]);

    expect(rows(wrapper)).toHaveLength(1);
  });

  test('and the row says how many', () => {
    const wrapper = render([activity(), activity(), activity()]);

    expect(rows(wrapper)[0]!.text()).toContain('3');
  });

  test('different clips stay separate', () => {
    const wrapper = render([activity({ segmentPublicId: 's1' }), activity({ segmentPublicId: 's2' })]);

    expect(rows(wrapper)).toHaveLength(2);
  });

  test('different KINDS of activity stay separate', () => {
    const wrapper = render([activity({ activityType: 'SEGMENT_PLAY' }), activity({ activityType: 'SHARE' })]);

    expect(rows(wrapper)).toHaveLength(2);
  });

  test('only CONSECUTIVE repeats group, so the timeline stays in order', () => {
    // Collapsing non-adjacent entries would move an event to a time it did not
    // happen at.
    const wrapper = render([activity(), activity({ segmentPublicId: 's2' }), activity()]);

    expect(rows(wrapper)).toHaveLength(3);
  });

  test('the same search inside a title is a DIFFERENT row from the same search everywhere', () => {
    // The title a search was run inside is part of which search it was.
    const wrapper = render([
      activity({ activityType: 'SEARCH', searchQuery: '猫', mediaPublicId: null, segmentPublicId: null }),
      activity({ activityType: 'SEARCH', searchQuery: '猫', mediaPublicId: 'm1', segmentPublicId: null }),
    ]);

    expect(rows(wrapper)).toHaveLength(2);
  });
});

describe('the Japanese it shows', () => {
  test('has the search highlighting stripped out', () => {
    const wrapper = render([activity({ japaneseText: '<em>猫</em>が好き' })]);

    expect(rows(wrapper)[0]!.text()).toContain('猫が好き');
    expect(rows(wrapper)[0]!.html()).not.toContain('<em>');
  });

  test('and nested or malformed tags leave no markup behind', () => {
    // The strip runs until the text stops changing. With a greedy `[^>]*` a
    // single pass already handles the inputs here, so the loop is defensive
    // rather than load-bearing for them -- what is pinned is the outcome: no
    // markup reaches the row whatever shape the highlighting arrived in.
    const wrapper = render([activity({ japaneseText: '<<em>em>猫<</em>/em>' })]);

    expect(rows(wrapper)[0]!.html()).not.toContain('<em>');
  });
});

describe('where a row leads', () => {
  test('a played clip opens its sentence', async () => {
    const wrapper = render([activity({ activityType: 'SEGMENT_PLAY' })]);

    await rows(wrapper)[0]!.trigger('click');

    expect(push).toHaveBeenCalledWith(expect.stringContaining('s1'));
  });

  test('a search reruns the search, scoped as it was', async () => {
    const wrapper = render([
      activity({ activityType: 'SEARCH', searchQuery: '猫', segmentPublicId: null, mediaPublicId: 'm1' }),
    ]);

    await rows(wrapper)[0]!.trigger('click');

    // The query is percent-encoded into the path, so assert on the encoding
    // rather than on the raw character.
    expect(push).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('猫')));
  });

  test('an entry with no segment leads nowhere rather than to a broken page', async () => {
    const wrapper = render([
      activity({ activityType: 'SEGMENT_PLAY', segmentPublicId: null, mediaName: null, japaneseText: null }),
    ]);

    await rows(wrapper)[0]!.trigger('click');

    expect(push).not.toHaveBeenCalled();
  });

  test('nor does one whose segment has since lost its text and title', async () => {
    // The id survives in the log after the segment is gone; without something
    // to show, the link goes to a page that cannot render.
    const wrapper = render([
      activity({ activityType: 'SEGMENT_PLAY', segmentPublicId: 's1', mediaName: null, japaneseText: null }),
    ]);

    await rows(wrapper)[0]!.trigger('click');

    expect(push).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  test('removes every id the grouped row stands for, not just the newest', async () => {
    // A row saying "3" that deletes one leaves two behind and reads as broken.
    const wrapper = render([activity(), activity(), activity()]);

    // Identified by its `title` -- the control carries one rather than an
    // aria-label, and it is the only per-row button.
    const remove = wrapper.find('tbody tr button');
    if (!remove.exists()) throw new Error('no delete control');
    await remove.trigger('click');

    expect(wrapper.emitted('delete')?.[0]?.[0]).toEqual([1, 2, 3]);
  });
});
