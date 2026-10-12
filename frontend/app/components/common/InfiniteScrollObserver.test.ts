// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/** Prefetch a screen early for tall sentence rows; observer exit events must not load another page. */
type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

let lastCallback: ObserverCallback | null = null;
let lastOptions: IntersectionObserverInit | null = null;
const observe = vi.fn();
const disconnect = vi.fn();
const unobserve = vi.fn();

class FakeIntersectionObserver {
  constructor(cb: ObserverCallback, options: IntersectionObserverInit) {
    lastCallback = cb;
    lastOptions = options;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = unobserve;
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

import InfiniteScrollObserver from './InfiniteScrollObserver.vue';

const mounted: { unmount: () => void }[] = [];

async function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(InfiniteScrollObserver, { props, attachTo: document.body });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastCallback = null;
  lastOptions = null;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('watching for the end of the list', () => {
  test('observes its own sentinel element', async () => {
    await render();

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0]![0]).toBeInstanceOf(HTMLElement);
  });

  test('starts loading a screen early by default', async () => {
    // Rows are tall and a page takes a moment; reaching the sentinel is already
    // too late.
    await render();

    expect(lastOptions?.rootMargin).toBe('1200px');
  });

  test('a denser grid can ask for less lead time', async () => {
    await render({ rootMargin: '200px' });

    expect(lastOptions?.rootMargin).toBe('200px');
  });
});

describe('what it does when the sentinel moves', () => {
  test('asks for the next page on the way IN', async () => {
    const wrapper = await render();

    lastCallback?.([{ isIntersecting: true }]);

    expect(wrapper.emitted('intersect')).toHaveLength(1);
  });

  test('and NOT on the way out', async () => {
    // The observer fires both ways; acting on both fetches a page every time
    // the reader scrolls back up past the sentinel.
    const wrapper = await render();

    lastCallback?.([{ isIntersecting: false }]);

    expect(wrapper.emitted('intersect')).toBeUndefined();
  });

  test('an empty entry list is not an intersection', async () => {
    const wrapper = await render();

    lastCallback?.([]);

    expect(wrapper.emitted('intersect')).toBeUndefined();
  });

  test('each crossing asks again, so a long list keeps loading', async () => {
    const wrapper = await render();

    lastCallback?.([{ isIntersecting: true }]);
    lastCallback?.([{ isIntersecting: false }]);
    lastCallback?.([{ isIntersecting: true }]);

    expect(wrapper.emitted('intersect')).toHaveLength(2);
  });
});

describe('teardown', () => {
  test('disconnects, so a removed list stops asking for pages', async () => {
    const wrapper = await render();

    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);

    expect(disconnect).toHaveBeenCalled();
  });
});
