// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/**
 * The site-wide announcement bar.
 *
 * Purely additive chrome, and that shapes every decision: "no announcement" is
 * served as an ERROR by the backend endpoint, so a null covers both that and a
 * genuine failure -- and either way the banner simply does not appear rather
 * than putting an error where the reader expected the page.
 *
 * An announcement that exists but is INACTIVE must stay hidden: taking one down
 * writes `active: false` rather than deleting it, so the stored row outlives the
 * banner and showing it would resurrect a notice an admin retired.
 */
const announcement = ref<Record<string, unknown> | null>(null);
const fetchFails = ref(false);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useFetch', async (_url: string, opts?: { default?: () => unknown }) => {
  const data = ref(fetchFails.value ? (opts?.default?.() ?? null) : { announcement: announcement.value });
  return { data, error: ref(null), pending: ref(false), refresh: vi.fn() };
});

import SystemAnnouncementBanner from './SystemAnnouncementBanner.vue';

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({
    components: { SystemAnnouncementBanner },
    template: '<Suspense><SystemAnnouncementBanner /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      // The message goes through a child that renders it; stubbed opaquely the
      // banner carries the admin's words nowhere the test can see them.
      stubs: {
        UiBaseIcon: true,
        CommonAnnouncementText: { props: ['message'], template: '<span>{{ message }}</span>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const shown = (w: ReturnType<typeof mount>) => w.find('div[class*="border-red"]').exists();

beforeEach(() => {
  vi.clearAllMocks();
  announcement.value = null;
  fetchFails.value = false;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('when the banner appears', () => {
  test('an active announcement is shown', async () => {
    announcement.value = { active: true, type: 'MAINTENANCE', message: 'Down tonight' };

    expect(shown(await render())).toBe(true);
  });

  test('with the admin’s own words', async () => {
    // The heading translates; the body is admin-authored free text with no
    // per-locale variant.
    announcement.value = { active: true, type: 'MAINTENANCE', message: 'Down tonight' };

    expect((await render()).text()).toContain('Down tonight');
  });

  test('and a translated heading for its kind', async () => {
    announcement.value = { active: true, type: 'MAINTENANCE', message: 'x' };

    expect((await render()).text()).toContain('announcement');
  });
});

describe('when it does not', () => {
  test('an INACTIVE announcement stays hidden', async () => {
    // Taking one down writes `active: false` rather than deleting it, so the
    // row outlives the banner.
    announcement.value = { active: false, type: 'INFO', message: 'Old news' };

    const wrapper = await render();
    expect(shown(wrapper)).toBe(false);
    expect(wrapper.text()).not.toContain('Old news');
  });

  test('no announcement configured shows nothing', async () => {
    announcement.value = null;

    expect(shown(await render())).toBe(false);
  });

  test('and neither does a failed lookup', async () => {
    // The endpoint answers "none configured" with an error, so the two arrive
    // identically -- and the banner is chrome either way.
    fetchFails.value = true;

    expect(shown(await render())).toBe(false);
  });
});
