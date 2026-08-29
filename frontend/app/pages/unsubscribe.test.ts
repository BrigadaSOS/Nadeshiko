// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

/**
 * Where the unsubscribe link in a lifecycle email lands.
 *
 * The property that matters most here is what this page does NOT do: it changes
 * nothing on arrival. Mail scanners and link-preview bots fetch every URL in a
 * message before the recipient has seen it, so a page that opted somebody out on
 * load would unsubscribe readers from mail they never opened -- silently, and
 * with no way for us to find out. The GET reads; the writes are explicit.
 *
 * The rest is the offer itself. Somebody who clicked this link is on their way
 * out, and a reader who only wanted the monthly recap to stop will take that
 * option if it is in front of them and take "stop everything" if it is not --
 * so the page must show the categories, and the state it shows has to be the
 * one the server actually holds rather than an optimistic guess.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const getEmailPreferencesByToken = vi.fn();
const updateEmailPreferencesByToken = vi.fn();
const route = reactive({
  query: {} as Record<string, unknown>,
  path: '/unsubscribe',
  params: {},
  fullPath: '/unsubscribe',
});

vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useNadeshikoSdk', () => ({ getEmailPreferencesByToken, updateEmailPreferencesByToken }));

import UnsubscribePage from './unsubscribe.vue';

const prefs = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  categories: { recap: true, checkins: true, updates: true },
  category: 'recap',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

async function render(token = 'tok-1') {
  route.query = token ? { token } : {};
  const wrapper = mount(UnsubscribePage, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { NuxtLink: { props: ['to'], template: '<a><slot /></a>' }, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** One switch by name: `all`, or a category. */
function toggleFor(wrapper: ReturnType<typeof mount>, name: string) {
  const button = wrapper.find(`[data-testid="unsubscribe-${name}"]`);
  if (!button.exists()) throw new Error(`no switch for ${name}`);
  return button;
}
const pressed = (w: ReturnType<typeof mount>, name: string) => toggleFor(w, name).attributes('aria-pressed') === 'true';
const switches = (w: ReturnType<typeof mount>) => w.findAll('button[aria-pressed]');

beforeEach(() => {
  vi.clearAllMocks();
  getEmailPreferencesByToken.mockResolvedValue(prefs());
  updateEmailPreferencesByToken.mockResolvedValue(prefs());
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('arriving on the page', () => {
  test('READS the preferences and changes nothing', async () => {
    // A mail scanner fetching this URL must not opt anybody out.
    await render();

    expect(getEmailPreferencesByToken).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(updateEmailPreferencesByToken).not.toHaveBeenCalled();
  });

  test('shows the switches once the token resolves', async () => {
    const wrapper = await render();

    expect(switches(wrapper).length).toBeGreaterThan(0);
  });

  test('reflects what the server holds, not a default', async () => {
    // Showing everything as on to somebody who already stopped the recap tells
    // them their last unsubscribe did not work.
    getEmailPreferencesByToken.mockResolvedValue(
      prefs({ categories: { recap: false, checkins: true, updates: true } }),
    );
    const wrapper = await render();

    const pressed = switches(wrapper).map((b) => b.attributes('aria-pressed'));
    expect(pressed).toContain('false');
  });

  test('a missing token fails without calling anything', async () => {
    await render('');

    expect(getEmailPreferencesByToken).not.toHaveBeenCalled();
    expect(switches(await render(''))).toHaveLength(0);
  });

  test('a token the server rejects names the way out', async () => {
    // The one failure the reader can route around themselves: the same switches
    // live in their settings.
    getEmailPreferencesByToken.mockRejectedValue({ status: 400 });
    const wrapper = await render();

    expect(wrapper.text()).toContain('unsubscribe.invalid');
  });

  test('any other failure is reported as a failure, not as a bad link', async () => {
    getEmailPreferencesByToken.mockRejectedValue({ status: 500 });
    const wrapper = await render();

    expect(wrapper.text()).toContain('unsubscribe.failed');
    expect(handleApiError).toHaveBeenCalledWith('email.unsubscribe', expect.anything(), { toastKey: false });
  });
});

describe('flipping a switch', () => {
  test('sends only the one that moved', async () => {
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(updateEmailPreferencesByToken).toHaveBeenCalledExactlyOnceWith({ token: 'tok-1', recap: false });
  });

  test('adopts the CATEGORY state the server sends back rather than assuming', async () => {
    // Asserted with the master switch still ON, so the categories are read on
    // their own: with `enabled` false they all render off regardless and the
    // assertion would pass without the server's answer being used at all.
    updateEmailPreferencesByToken.mockResolvedValue(
      prefs({ enabled: true, categories: { recap: false, checkins: true, updates: true } }),
    );
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(pressed(wrapper, 'recap')).toBe(false);
    expect(pressed(wrapper, 'checkins')).toBe(true);
  });

  test('the master switch follows the server too', async () => {
    updateEmailPreferencesByToken.mockResolvedValue(prefs({ enabled: false }));
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(pressed(wrapper, 'all')).toBe(false);
  });

  test('says which switch moved, because there are four on one card', async () => {
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalled();
  });

  test('every switch goes dead while one is saving, because they share a record', async () => {
    // Guarded on the buttons as well as in the handler, and the buttons are
    // what a reader meets: two writes in flight would race over one record.
    let release!: () => void;
    updateEmailPreferencesByToken.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(toggleFor(wrapper, 'checkins').attributes('disabled')).toBeDefined();
    expect(toggleFor(wrapper, 'all').attributes('disabled')).toBeDefined();
    await toggleFor(wrapper, 'checkins').trigger('click');
    release();
    await flushPromises();

    expect(updateEmailPreferencesByToken).toHaveBeenCalledTimes(1);
  });

  test('a failed write drops to the failure state rather than lying', async () => {
    // And the switches go with it: leaving them on screen after a write that did
    // not land shows a reader an opt-out they do not have.
    updateEmailPreferencesByToken.mockRejectedValue({ status: 500 });
    const wrapper = await render();

    await toggleFor(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('unsubscribe.failed');
    expect(wrapper.find('[data-testid="unsubscribe-recap"]').exists()).toBe(false);
  });
});
