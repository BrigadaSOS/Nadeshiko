// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

// Clear one-time codes after success to prevent replay on reload; preserve failed URLs for retry.
// Declined consent is not an exchange failure.
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
// Preserve translation params so the linked-name assertion checks the actual account name.
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
    await render({ code: 'c1', state: 's1' });

    expect(replace).toHaveBeenCalledWith({ path: '/link/shirabe/callback', query: {} });
  });

  test('and stops there rather than redirecting on', async () => {
    const wrapper = await render({ code: 'c1', state: 's1' });

    expect(wrapper.text()).not.toContain('connections.callback.failed');
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('a reader who said no', () => {
  test('is told they declined, not that something broke', async () => {
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
