// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

/**
 * The feedback panel.
 *
 * Its anti-spam machinery is the part worth pinning, because both halves fail
 * SILENTLY when they go wrong. The form token carries a minted-at time, so a
 * token fetched at submit would always be younger than the minimum fill time and
 * the report would be dropped as automated with nobody told; the component
 * therefore refuses to submit without one and says so. And `nickname` is a
 * honeypot -- it is sent precisely because it is empty, since a field that is
 * never transmitted cannot trap anything.
 *
 * A spent token is dropped too: reusing one whose age describes a form the
 * reader already submitted is the same silent drop by another route.
 */
const handleApiError = vi.fn<(...args: unknown[]) => { status?: number } | null>(() => null);
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const createFeedback = vi.fn();
const getFeedbackFormToken = vi.fn();
const isFeedbackOpen = ref(false);
const closeFeedback = vi.fn(() => {
  isFeedbackOpen.value = false;
});
const isLoggedIn = ref(false);
const route = reactive({ fullPath: '/en/search/cat', path: '/en/search/cat', params: {}, query: {} });

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('es') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appVersion: '2.4.12' } }));
vi.stubGlobal('useFeedbackWidget', () => ({ isFeedbackOpen, openFeedback: vi.fn(), closeFeedback }));
vi.stubGlobal('useNadeshikoSdk', () => ({ createFeedback, getFeedbackFormToken }));
// MOCKED as a module, not stubbed as a global: this component imports
// `userStore` directly, so a `stubGlobal` never applies and the real (always
// signed-out) store is used -- which made "not sent for a signed-in reader" pass
// on an empty box rather than on the guard.
vi.mock('~/stores/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    userStore: () => ({
      get isLoggedIn() {
        return isLoggedIn.value;
      },
      user: { id: 'u1' },
    }),
  };
});
vi.stubGlobal('usePostHog', () => ({ __loaded: false }));

import FeedbackWidget from './FeedbackWidget.vue';

const mounted: { unmount: () => void }[] = [];

async function open() {
  const wrapper = mount(FeedbackWidget, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  isFeedbackOpen.value = true;
  await flushPromises();
  return wrapper;
}

const messageBox = (w: ReturnType<typeof mount>) => w.get('textarea');
/** The honeypot: a text input the reader never sees. */
const honeypot = (w: ReturnType<typeof mount>) => w.findAll('input').find((n) => n.attributes('type') === 'text');
const emailBox = (w: ReturnType<typeof mount>) => w.findAll('input').find((n) => n.attributes('type') === 'email');

/** Submits the FORM, which is where the handler is bound -- clicking the button
 *  alone does not run it. */
async function send(w: ReturnType<typeof mount>) {
  const form = w.find('form');
  if (!form.exists()) throw new Error('the form is not on screen (already sent?)');
  await form.trigger('submit');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  isFeedbackOpen.value = false;
  isLoggedIn.value = false;
  createFeedback.mockResolvedValue({});
  getFeedbackFormToken.mockResolvedValue({ token: 'tok-1' });
  handleApiError.mockReturnValue(null);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.useRealTimers();
});

describe('the form token', () => {
  test('is fetched when the panel opens, not when it is submitted', async () => {
    // Minted at submit it would be younger than the minimum fill time, and the
    // report would be dropped as automated with nobody told.
    await open();

    expect(getFeedbackFormToken).toHaveBeenCalled();
  });

  test('a submission without one says so instead of failing silently', async () => {
    getFeedbackFormToken.mockRejectedValue(new Error('down'));
    const wrapper = await open();
    await messageBox(wrapper).setValue('the audio cuts out');

    await send(wrapper);

    expect(createFeedback).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('feedback.errorRetry');
  });

  test('and asks for a fresh one in the background so the retry can work', async () => {
    getFeedbackFormToken.mockRejectedValue(new Error('down'));
    const wrapper = await open();
    await messageBox(wrapper).setValue('the audio cuts out');
    getFeedbackFormToken.mockClear();

    await send(wrapper);

    expect(getFeedbackFormToken).toHaveBeenCalled();
  });

  test('is spent once used, so the next open mints a new one', async () => {
    const wrapper = await open();
    await messageBox(wrapper).setValue('the audio cuts out');
    await send(wrapper);
    getFeedbackFormToken.mockClear();

    isFeedbackOpen.value = false;
    await nextTick();
    isFeedbackOpen.value = true;
    await flushPromises();

    expect(getFeedbackFormToken).toHaveBeenCalled();
  });
});

describe('sending a report', () => {
  test('will not send an empty message', async () => {
    const wrapper = await open();

    await send(wrapper);

    expect(createFeedback).not.toHaveBeenCalled();
  });

  test('nor one that is only whitespace', async () => {
    const wrapper = await open();
    await messageBox(wrapper).setValue('    ');

    await send(wrapper);

    expect(createFeedback).not.toHaveBeenCalled();
  });

  test('sends the message trimmed, with the token and the page it came from', async () => {
    const wrapper = await open();
    await messageBox(wrapper).setValue('  the audio cuts out  ');

    await send(wrapper);

    expect(createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'the audio cuts out',
        formToken: 'tok-1',
        pagePath: '/en/search/cat',
      }),
    );
  });

  test('reports the locale the PAGE is in, not the browser’s', async () => {
    // A reader on /es with an English browser is reading Spanish.
    const wrapper = await open();
    await messageBox(wrapper).setValue('hola');

    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0].locale).toBe('es');
  });

  test('carries the app version, so a report can be tied to a release', async () => {
    const wrapper = await open();
    await messageBox(wrapper).setValue('x');

    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0].appVersion).toBe('2.4.12');
  });
});

describe('the honeypot', () => {
  test('is sent as undefined when untouched, which is what makes it a trap', async () => {
    // A field that is never transmitted cannot trap anything.
    const wrapper = await open();
    await messageBox(wrapper).setValue('x');

    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0]).toHaveProperty('nickname');
    expect(createFeedback.mock.calls[0]![0].nickname).toBeUndefined();
  });

  test('carries whatever filled it, so the server can drop the submission', async () => {
    const wrapper = await open();
    await messageBox(wrapper).setValue('x');
    const trap = honeypot(wrapper);
    if (trap) await trap.setValue('a bot wrote here');

    await send(wrapper);

    if (trap) expect(createFeedback.mock.calls[0]![0].nickname).toBe('a bot wrote here');
  });
});

describe('the reply address', () => {
  test('is asked for from a signed-out reader', async () => {
    const wrapper = await open();

    expect(emailBox(wrapper)).toBeTruthy();
  });

  test('and not sent for a signed-in one, whose address we already have', async () => {
    isLoggedIn.value = true;
    const wrapper = await open();
    await messageBox(wrapper).setValue('x');

    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0].email).toBeUndefined();
  });

  test('a typed address is dropped if they sign in before sending', async () => {
    // The panel stays open across a sign-in, so the box can hold an address
    // that is no longer the one to reply to. This is the case the guard exists
    // for -- with the field merely hidden, the stale value still travels.
    const wrapper = await open();
    const box = emailBox(wrapper);
    if (!box) throw new Error('the reply-address box is not on screen');
    await box.setValue('typed@example.test');
    await messageBox(wrapper).setValue('x');

    isLoggedIn.value = true;
    await nextTick();
    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0].email).toBeUndefined();
  });

  test('and IS sent for a reader who stays signed out', async () => {
    const wrapper = await open();
    const box = emailBox(wrapper);
    if (!box) throw new Error('the reply-address box is not on screen');
    await box.setValue('  reader@example.test  ');
    await messageBox(wrapper).setValue('x');

    await send(wrapper);

    expect(createFeedback.mock.calls[0]![0].email).toBe('reader@example.test');
  });
});

describe('when it goes wrong', () => {
  test('says so inside the panel, which still holds what they wrote', async () => {
    createFeedback.mockRejectedValue(new Error('down'));
    const wrapper = await open();
    await messageBox(wrapper).setValue('the audio cuts out');

    await send(wrapper);

    expect(wrapper.text()).toContain('feedback.error');
    expect((messageBox(wrapper).element as HTMLTextAreaElement).value).toBe('the audio cuts out');
  });

  test('a rate limit gets its own message, because it is not a fault to retry blindly', async () => {
    createFeedback.mockRejectedValue(new Error('too many'));
    handleApiError.mockReturnValue({ status: 429 });
    const wrapper = await open();
    await messageBox(wrapper).setValue('x');

    await send(wrapper);

    expect(wrapper.text()).toContain('feedback.errorRateLimited');
  });
});
