// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

/**
 * The API-key panel: the reader's keys, and the quota they spend.
 *
 * The quota block is the part worth pinning. Every number in it has a FALLBACK,
 * because `/v1/user/me` failing must not blank the page -- and a fallback that
 * renders without saying it is one reads as a genuine "0 of 5000 used" to
 * somebody whose session just fell over. The burst line exists for the same
 * reason: a 429 with plenty of month left is otherwise unexplainable, which is
 * what sent the support thread behind it to us.
 *
 * The other thing here is scope selection, where the two mistakes cost very
 * different amounts: too few scopes is a second visit to this page, too many is
 * a credential in someone else's code that can rewrite the account.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const authApiKeyList = vi.fn();
const getMe = vi.fn();
const createApiKeyGeneral = vi.fn();
const renameApiKey = vi.fn();
const deactivateApiKey = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useFormat', () => ({
  formatDate: (d: Date | string) => new Date(d).toISOString().slice(0, 10),
}));
vi.stubGlobal('useNadeshikoSdk', () => ({ authApiKeyList, getMe }));
vi.stubGlobal('apiStore', () => ({ createApiKeyGeneral, renameApiKey, deactivateApiKey }));
vi.stubGlobal('useToastError', vi.fn());
vi.stubGlobal('useToastSuccess', vi.fn());
vi.stubGlobal('copyToClipboard', vi.fn().mockResolvedValue(true));
vi.stubGlobal('useEnterSubmit', () => ({}));
vi.stubGlobal('useAsyncData', async (_k: string, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const refresh = async () => {
    data.value = await handler();
  };
  await refresh();
  return { data, refresh };
});

import { FULL_ACCOUNT_API_KEY_SCOPES, READ_ONLY_API_KEY_SCOPES } from '@/stores/api';
import DeveloperSettings from './DeveloperSettings.vue';

function key(over: Record<string, unknown> = {}) {
  return { id: 'k1', name: 'Key one', enabled: true, createdAt: '2026-01-01T00:00:00Z', ...over };
}

const mounted: { unmount: () => void }[] = [];

async function render(keys?: unknown, me: unknown = { quota: {} }) {
  // Left alone when omitted, so a test can arrange a REJECTION before calling.
  if (keys !== undefined) authApiKeyList.mockResolvedValue(keys);
  if (me === null) getMe.mockRejectedValue(new Error('down'));
  else getMe.mockResolvedValue(me);

  const Host = defineComponent({
    components: { DeveloperSettings },
    template: '<Suspense><DeveloperSettings /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k) },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const rows = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="api-key-row"]');

beforeEach(() => {
  vi.clearAllMocks();
  authApiKeyList.mockResolvedValue([]);
  getMe.mockResolvedValue({ quota: {} });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('reading the key list', () => {
  test('accepts a bare array', async () => {
    expect(rows(await render([key()]))).toHaveLength(1);
  });

  test('and an object wrapping one, which is the other shape the API returns', async () => {
    expect(rows(await render({ apiKeys: [key()] }))).toHaveLength(1);
  });

  test('an unrecognised shape is an empty list rather than a crash', async () => {
    expect(rows(await render({ unexpected: true }))).toHaveLength(0);
  });

  test('hides keys that have already been deactivated', async () => {
    // They cannot be used and cannot be revived; listing them is only clutter
    // with a Revoke button beside it.
    const wrapper = await render([key(), key({ id: 'k2', name: 'Dead', enabled: false })]);

    expect(rows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Dead');
  });

  test('newest first, so a key just created is at the top', async () => {
    const wrapper = await render([
      key({ id: 'old', name: 'Older', createdAt: '2025-01-01T00:00:00Z' }),
      key({ id: 'new', name: 'Newer', createdAt: '2026-06-01T00:00:00Z' }),
    ]);

    expect(rows(wrapper)[0]!.text()).toContain('Newer');
  });

  test('a FAILED list is not an account with no keys', async () => {
    authApiKeyList.mockRejectedValue(new Error('down'));
    const wrapper = await render();

    expect(wrapper.find('[data-testid="api-keys-load-error"]').exists()).toBe(true);
  });

  test('an account with genuinely no keys shows no error', async () => {
    const wrapper = await render([]);

    expect(wrapper.find('[data-testid="api-keys-load-error"]').exists()).toBe(false);
  });
});

describe('the quota block', () => {
  test('shows how much of the allowance is gone', async () => {
    const wrapper = await render([], { quota: { used: 250, limit: 1000, remaining: 750 } });

    expect(wrapper.text()).toContain('25%');
  });

  test('a zero limit cannot produce a NaN or an infinite bar', async () => {
    // Clamped to one rather than divided by: the bar's width is this number.
    const wrapper = await render([], { quota: { used: 0, limit: 0, remaining: 0 } });

    expect(wrapper.text()).toContain('0%');
    expect(wrapper.text()).not.toContain('NaN');
    expect(wrapper.text()).not.toContain('Infinity');
  });

  test('a failed `me` falls back rather than blanking the panel', async () => {
    const wrapper = await render([], null);

    expect(wrapper.find('[data-testid="api-keys-load-error"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('NaN');
  });
});

describe('the burst line', () => {
  test('is phrased per minute, whatever window the server used', async () => {
    // 30 in 10 seconds is 180 a minute, and per-minute is the unit a reader can
    // compare against what their script is doing.
    const wrapper = await render([], { quota: { burst: { max: 30, windowMs: 10_000 } } });

    expect(wrapper.text()).toContain('"max":180');
  });

  test('says nothing at all when there is no burst allowance', async () => {
    const wrapper = await render([], { quota: {} });

    expect(wrapper.text()).not.toContain('burstLimit');
  });

  test('and nothing for a nonsense window, rather than dividing by zero', async () => {
    const wrapper = await render([], { quota: { burst: { max: 30, windowMs: 0 } } });

    expect(wrapper.text()).not.toContain('burstLimit');
  });
});

describe('when the allowance comes back', () => {
  test('the day AFTER the period ends, which is when the refill happens', async () => {
    const wrapper = await render([], { quota: { periodEnd: '2026-08-31T23:59:59.999Z' } });

    expect(wrapper.text()).toContain('2026-09-01');
  });

  test('says nothing when the server did not give a period', async () => {
    const wrapper = await render([], { quota: { periodEnd: null } });

    expect(wrapper.text()).not.toContain('quotaResets');
  });

  test('and nothing for a date it cannot read, with the panel still standing', async () => {
    // The panel has to be asserted alive as well: an unguarded invalid date
    // throws out of the computed, the whole card fails to render, and "does not
    // mention a reset date" then passes because NOTHING rendered.
    const wrapper = await render([], { quota: { periodEnd: 'not-a-date' } });

    expect(wrapper.find('[data-testid="add-api-key-button"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('quotaResets');
  });
});

describe('choosing what a new key can do', () => {
  async function openCreate(wrapper: ReturnType<typeof mount>) {
    await wrapper.get('[data-testid="add-api-key-button"]').trigger('click');
    await nextTick();
  }

  const preset = (wrapper: ReturnType<typeof mount>, name: string) =>
    wrapper.get(`[data-testid="create-apikey-preset-${name}"]`).element as HTMLInputElement;

  test('opens on READ-ONLY, because the two mistakes do not cost the same', async () => {
    // Too few scopes is a second visit here; too many is a credential in
    // somebody else's code that can rewrite this account.
    const wrapper = await render([]);
    await openCreate(wrapper);

    expect(preset(wrapper, 'readOnly').checked).toBe(true);
    expect(preset(wrapper, 'fullAccount').checked).toBe(false);
  });

  test('sends the scopes of the preset the reader chose', async () => {
    const wrapper = await render([]);
    createApiKeyGeneral.mockResolvedValue({ key: 'nd_secret' });
    await openCreate(wrapper);

    await wrapper.get('[data-testid="create-apikey-preset-fullAccount"]').setValue();
    await wrapper.find('[data-testid="create-apikey-modal"] input[type="text"]').setValue('CI key');
    await wrapper.get('[data-testid="create-apikey-submit"]').trigger('click');
    await flushPromises();

    const [name, scopes] = createApiKeyGeneral.mock.calls[0]!;
    expect(name).toBe('CI key');
    expect(scopes).toEqual(FULL_ACCOUNT_API_KEY_SCOPES);
  });

  test('read-only really is a subset, not the same list under another name', async () => {
    // The presets are the whole safety story here; two labels over one scope set
    // would be worse than having no presets at all.
    expect(READ_ONLY_API_KEY_SCOPES.length).toBeLessThan(FULL_ACCOUNT_API_KEY_SCOPES.length);
    for (const scope of READ_ONLY_API_KEY_SCOPES) {
      expect(FULL_ACCOUNT_API_KEY_SCOPES).toContain(scope);
    }
  });

  test('shows the new key once it exists, because it is never shown again', async () => {
    const wrapper = await render([]);
    createApiKeyGeneral.mockResolvedValue({ key: 'nd_secret' });
    await openCreate(wrapper);

    await wrapper.find('[data-testid="create-apikey-modal"] input[type="text"]').setValue('CI key');
    await wrapper.get('[data-testid="create-apikey-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="api-key-created-alert"]').text()).toContain('nd_secret');
  });

  test('reopening the dialog forgets the last choice', async () => {
    // Otherwise a reader who once made a full-access key gets full access as the
    // default for every key after it.
    const wrapper = await render([]);
    await openCreate(wrapper);
    await wrapper.get('[data-testid="create-apikey-preset-fullAccount"]').setValue();
    await nextTick();

    await openCreate(wrapper);

    expect(preset(wrapper, 'readOnly').checked).toBe(true);
  });
});
