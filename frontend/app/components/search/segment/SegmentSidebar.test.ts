// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The filter drawer and the scroll-to-top button beside it.
 *
 * The drawer is gated on the MEDIA STATS, not on the results, and that is the
 * whole point: `results` is emptied at the start of every fetch, so gating on it
 * made the button vanish and reappear on each search and left anyone who opened
 * it mid-flight looking at an empty drawer. The stats survive the fetch and go
 * empty only when the query genuinely matched no titles.
 *
 * The scroll button is deliberately NOT gated the same way -- it is about the
 * page, not the results, and belongs on every view including the single-sentence
 * page where there is nothing to filter.
 */
const scrollBehavior = vi.fn(() => 'smooth');
const routeLeaveGuards: ((to: { path: string }) => void)[] = [];

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useMotionPreference', () => ({ scrollBehavior }));
vi.stubGlobal('onBeforeRouteLeave', (fn: (to: { path: string }) => void) => routeLeaveGuards.push(fn));

import { splitLocalePrefix } from '~/utils/routes';
vi.stubGlobal('splitLocalePrefix', splitLocalePrefix);

import SegmentSidebar from './SegmentSidebar.vue';

const mounted: { unmount: () => void }[] = [];

function render(props: Record<string, unknown> = {}) {
  // The controls TELEPORT into a dock the layout renders, so the target has to
  // exist -- without it they mount nowhere and every assertion about them reads
  // as "the button is not offered".
  const dock = document.createElement('div');
  dock.id = 'nd-fab-dock';
  document.body.appendChild(dock);

  const wrapper = mount(SegmentSidebar, {
    props: { searchData: { media: [{ mediaPublicId: 'm1' }] }, ...props } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchSegmentFilterContent: true,
        CommonBaseModal: { props: ['open'], template: '<div v-if="open" data-testid="filter-drawer"><slot /></div>' },
        SearchSegmentFilterSortContent: true,
        ClientOnly: { template: '<div><slot /></div>' },
        UiBaseIcon: true,
        teleport: false,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/** Queried on the DOCUMENT: these are teleported out of the component. */
const el = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const drawerToggle = () => el('filter-drawer-toggle');
const drawerOpen = () => el('filter-drawer') !== null;
const scrollButton = () => el('scroll-to-top');

async function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  routeLeaveGuards.length = 0;
  scrollBehavior.mockReturnValue('smooth');
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('whether the drawer is offered', () => {
  test('yes when the search came back with titles to filter by', () => {
    render();

    expect(drawerToggle()).not.toBeNull();
  });

  test('no when the query matched no titles at all', () => {
    // Then there is nothing to filter and no button to offer.
    render({ searchData: { media: [] } });

    expect(drawerToggle() !== null).toBe(false);
  });

  test('and no on a view that cannot be filtered', () => {
    // The single-sentence page: picking a title used to push `?media=` onto
    // `/sentence/<id>`, a query that page ignores.
    render({ filterable: false });

    expect(drawerToggle() !== null).toBe(false);
  });

  test('a payload with no stats block at all offers nothing', () => {
    render({ searchData: null });

    expect(drawerToggle() !== null).toBe(false);
  });
});

describe('opening and closing it', () => {
  test('the button opens it', async () => {
    render();

    await (drawerToggle() as HTMLElement).click();
    await nextTick();

    expect(drawerOpen()).toBe(true);
  });

  test('an emptied drawer does not SPRING BACK when titles arrive again', async () => {
    // While there are no titles the panel is unmounted anyway, so the latch is
    // what matters: left set, the next search that finds something reopens a
    // drawer the reader never asked for.
    const wrapper = render();
    (drawerToggle() as HTMLElement).click();
    await nextTick();
    expect(drawerOpen()).toBe(true);

    await wrapper.setProps({ searchData: { media: [] } as never });
    await nextTick();
    await wrapper.setProps({ searchData: { media: [{ mediaPublicId: 'm2' }] } as never });
    await nextTick();

    expect(drawerOpen()).toBe(false);
  });

  test('an open drawer closes itself when its contents go away', async () => {
    // A new search that matched no titles. Left open, it would spring back the
    // moment some arrived again.
    const wrapper = render();
    await (drawerToggle() as HTMLElement).click();
    await nextTick();
    expect(drawerOpen()).toBe(true);

    await wrapper.setProps({ searchData: { media: [] } as never });
    await nextTick();

    expect(drawerOpen()).toBe(false);
  });

  test('leaving the search entirely drops the latch', async () => {
    // Otherwise a later visit to search reopens a drawer last used elsewhere.
    render();
    await (drawerToggle() as HTMLElement).click();
    await nextTick();

    for (const guard of routeLeaveGuards) guard({ path: '/en/user/settings' });
    await nextTick();

    expect(drawerOpen()).toBe(false);
  });

  test('but moving between search and a title keeps it, because it is the same list', async () => {
    // `/search` ↔ `/media/<slug>` is the same list with a wider filter, and a
    // drawer the reader was working in has to still be there when they land.
    render();
    await (drawerToggle() as HTMLElement).click();
    await nextTick();

    for (const guard of routeLeaveGuards) guard({ path: '/en/media/bocchi' });
    await nextTick();

    expect(drawerOpen()).toBe(true);
  });

  test('and a locale-prefixed search path counts as the same list', async () => {
    render();
    await (drawerToggle() as HTMLElement).click();
    await nextTick();

    for (const guard of routeLeaveGuards) guard({ path: '/es/search/gato' });
    await nextTick();

    expect(drawerOpen()).toBe(true);
  });
});

describe('the scroll-to-top button', () => {
  test('stays hidden near the top of the page', async () => {
    render();

    await scrollTo(0);

    expect(scrollButton() !== null).toBe(false);
  });

  test('appears once the reader has scrolled a long way', async () => {
    render();

    await scrollTo(800);

    expect(scrollButton() !== null).toBe(true);
  });

  test('is offered even where the filters are not', async () => {
    // It is about the page, not the results.
    render({ filterable: false, searchData: { media: [] } });

    await scrollTo(800);

    expect(scrollButton() !== null).toBe(true);
  });

  test('scrolls the page, honouring the reader’s motion preference', async () => {
    scrollBehavior.mockReturnValue('auto');
    const scrollTo_ = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo_, configurable: true });
    render();
    await scrollTo(800);

    (scrollButton() as HTMLElement).click();
    await nextTick();

    expect(scrollTo_).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
