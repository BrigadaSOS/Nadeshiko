// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

/**
 * Where Shirabe sends the reader back after they approve.
 *
 * The code is one-time and two minutes old, and the exchange needs a PKCE
 * verifier only the backend has -- so it is handed straight over and never kept.
 * On SUCCESS the query is cleared from the address bar: left there, a reload
 * re-posted a consumed code and told the reader a link that had worked seconds
 * ago had failed, with the code sitting in browser history besides. On FAILURE
 * the URL stays, because then a reload is a genuine retry.
 *
 * A refusal is not a failure: `access_denied` means the reader looked at the
 * consent screen and said no, which is an answer and gets its own words.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const $fetch = vi.fn();
const replace = vi.fn();
const route = reactive({
  query: {} as Record<string, unknown>,
  path: '/link/shirabe/callback',
  params: {},
  fullPath: '/link/shirabe/callback',
});

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace, push: vi.fn() }) }));
vi.stubGlobal('$fetch', $fetch);
// The stub carries its params: the linked account's name reaches the page
// through one, and a stub that drops it makes "names who it linked as" pass
// without the name being there.
const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k}(${Object.values(p).join(',')})` : k);
vi.stubGlobal('useI18n', () => ({ t: tr, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('definePageMeta', vi.fn());

import ShirabeCallback from './callback.vue';

const mounted: { unmount: () => void }[] = [];

async function render(query: Record<string, unknown>) {
  route.query = query;
  const wrapper = mount(ShirabeCallback, {
    global: {
      mocks: { $t: tr },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  $fetch.mockResolvedValue({ connection: { shirabeName: 'Lumi' } });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('a successful return', () => {
  test('hands the code and state straight to the backend', async () => {
    await render({ code: 'c1', state: 's1' });

    expect($fetch).toHaveBeenCalledWith('/v1/user/connections/shirabe/callback', {
      method: 'POST',
      body: { code: 'c1', state: 's1' },
    });
  });

  test('names who the account was linked as', async () => {
    const wrapper = await render({ code: 'c1', state: 's1' });

    expect(wrapper.text()).toContain('Lumi');
  });

  test('and falls back to a name for an anonymous account', async () => {
    $fetch.mockResolvedValue({ connection: { shirabeName: null } });
    const wrapper = await render({ code: 'c1', state: 's1' });

    expect(wrapper.text()).toContain('connections.shirabe.anonymous');
  });

  test('CLEARS the spent code out of the address bar', async () => {
    // A reload would otherwise re-post a consumed code and report a failure for
    // a link that had just worked -- and the code would sit in history.
    await render({ code: 'c1', state: 's1' });

    expect(replace).toHaveBeenCalledWith({ path: '/link/shirabe/callback', query: {} });
  });

  test('and stops there rather than redirecting on', async () => {
    // Whether it worked is the only thing the reader came back to find out; a
    // redirect spends that moment on a settings page that looks unchanged.
    const wrapper = await render({ code: 'c1', state: 's1' });

    expect(wrapper.text()).not.toContain('connections.callback.failed');
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('a reader who said no', () => {
  test('is told they declined, not that something broke', async () => {
    // `access_denied` is an answer, not a fault.
    const wrapper = await render({ error: 'access_denied' });

    expect(wrapper.text()).toContain('connections.callback.declined');
    expect(wrapper.text()).not.toContain('connections.callback.failed');
  });

  test('and nothing is exchanged', async () => {
    await render({ error: 'access_denied' });

    expect($fetch).not.toHaveBeenCalled();
  });
});

describe('a return that cannot be used', () => {
  test.each([
    ['no code', { state: 's1' }],
    ['no state', { code: 'c1' }],
    ['neither', {}],
    ['some other error', { error: 'server_error', code: 'c1', state: 's1' }],
  ])('%s fails without exchanging anything', async (_name, query) => {
    const wrapper = await render(query);

    expect($fetch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('connections.callback.failed');
  });

  test('the URL is LEFT ALONE, so a reload is a retry', async () => {
    // The one case where reloading helps: the exchange never reached Shirabe.
    await render({ code: 'c1', state: 's1' });
    replace.mockClear();

    $fetch.mockRejectedValue(new Error('down'));
    await render({ code: 'c2', state: 's2' });

    expect(replace).not.toHaveBeenCalled();
  });

  test('a failed exchange says so and is reported', async () => {
    $fetch.mockRejectedValue(new Error('down'));
    const wrapper = await render({ code: 'c1', state: 's1' });

    expect(wrapper.text()).toContain('connections.callback.failed');
    expect(handleApiError).toHaveBeenCalled();
  });
});
