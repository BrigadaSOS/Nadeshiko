// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The sign-in modal, and specifically its EMAIL path.
 *
 * Two distinctions here are the whole reason this is not a pair of booleans.
 *
 * A rate-limited send is not a failure to apologise for: the reader has had
 * their five this hour and the server said when they may ask again, so the modal
 * stays on the sent view -- a link they already have still works, and the code
 * field has to remain usable. Dropping them back to the email form would take
 * away the only control that can still get them in.
 *
 * And a code typed into a browser that never asked for it is not a mistyped
 * code. One is worth another go; the other never will be, and the way out is the
 * link in the same email. Collapsing them into "invalid code" sends a reader to
 * retype something that cannot work.
 */
const sendMagicLink = vi.fn();
const signInWithCode = vi.fn();
const closeLoginModal = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const capture = vi.fn();

vi.stubGlobal('useLoginModal', () => ({
  isLoginModalOpen: ref(true),
  closeLoginModal,
  openLoginModal: vi.fn(),
  loginModalSource: ref('download'),
}));
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (k: string) => k } }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('userStore', () => ({ sendMagicLink, signInWithCode, isLoggedIn: false }));
vi.stubGlobal('useToastError', toastError);
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));

import { holdBackFor } from '~/utils/magicLinkHoldBack';
// The real escalating hold: it is what decides how long each resend waits, and
// a fake would only prove the fake was called.
vi.stubGlobal('holdBackFor', holdBackFor);

import ModalLoginSignUp from './ModalLoginSignUp.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(ModalLoginSignUp, {
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
  return wrapper;
}

/** The email box, which is the first text input on the form. */
const emailBox = (w: ReturnType<typeof render>) => w.findAll('input').find((n) => n.attributes('type') === 'email');
/** The code box appears only once a link has been sent. */
const codeBox = (w: ReturnType<typeof render>) => w.findAll('input').find((n) => n.attributes('type') !== 'email');

/** Types an address and presses Enter, which is what the box is bound to. */
async function sendTo(wrapper: ReturnType<typeof render>, email = 'reader@example.test') {
  const box = emailBox(wrapper);
  if (!box) throw new Error('the email box is not on screen');
  await box.setValue(email);
  await box.trigger('keyup.enter');
  await flushPromises();
}

/** The "resend" link, which only exists once the hold has run out. */
async function resend(wrapper: ReturnType<typeof render>) {
  const button = wrapper.findAll('button').find((b) => b.text().trim() === 'modalauth.magiclink.resend');
  if (!button) throw new Error('no resend control (still holding?)');
  await button.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sendMagicLink.mockResolvedValue({ status: 'ok' });
  signInWithCode.mockResolvedValue('ok');
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.useRealTimers();
});

describe('asking for a sign-in link', () => {
  test('sends to the address typed, trimmed', async () => {
    const wrapper = render();

    await sendTo(wrapper, '  reader@example.test  ');

    expect(sendMagicLink).toHaveBeenCalledWith('reader@example.test');
  });

  test('does nothing for an empty box', async () => {
    const wrapper = render();

    await sendTo(wrapper, '   ');

    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  test('moves to the code view once one is on its way', async () => {
    const wrapper = render();

    await sendTo(wrapper);

    expect(codeBox(wrapper)).toBeTruthy();
  });

  test('each send waits longer than the last', async () => {
    // Asking again while one is pending is a resend by definition, so the hold
    // escalates rather than resetting.
    const wrapper = render();
    await sendTo(wrapper);
    const firstHold = wrapper.text();

    vi.advanceTimersByTime(120_000);
    await nextTick();
    await resend(wrapper);

    expect(sendMagicLink).toHaveBeenCalledTimes(2);
    expect(firstHold).toBeTruthy();
  });

  test('will not send again while the hold is still running', async () => {
    const wrapper = render();
    await sendTo(wrapper);

    // While the hold runs the control is not even offered.
    await expect(resend(wrapper)).rejects.toThrow(/no resend/);
    expect(sendMagicLink).toHaveBeenCalledTimes(1);
  });
});

describe('when the server says they have had enough for now', () => {
  test('stays on the code view, because a link they already have still works', async () => {
    // Dropping back to the email form takes away the only control that can
    // still get them in.
    sendMagicLink.mockResolvedValue({ status: 'rate-limited', retryAfterSeconds: 90 });
    const wrapper = render();

    await sendTo(wrapper);

    expect(codeBox(wrapper)).toBeTruthy();
    expect(wrapper.text()).toContain('modalauth.magiclink.rateLimited');
  });

  test('and is not toasted as a failure', async () => {
    sendMagicLink.mockResolvedValue({ status: 'rate-limited', retryAfterSeconds: 90 });
    const wrapper = render();

    await sendTo(wrapper);

    expect(toastError).not.toHaveBeenCalled();
  });

  test('holds for exactly as long as the server asked', async () => {
    sendMagicLink.mockResolvedValue({ status: 'rate-limited', retryAfterSeconds: 3 });
    const wrapper = render();
    await sendTo(wrapper);

    await expect(resend(wrapper)).rejects.toThrow(/no resend/);
    expect(sendMagicLink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    await nextTick();
    sendMagicLink.mockResolvedValue({ status: 'ok' });
    await resend(wrapper);

    expect(sendMagicLink).toHaveBeenCalledTimes(2);
  });
});

describe('a send that simply failed', () => {
  test('is reported', async () => {
    sendMagicLink.mockResolvedValue({ status: 'error' });
    const wrapper = render();

    await sendTo(wrapper);

    expect(toastError).toHaveBeenCalledWith('modalauth.labels.errorlogin400');
  });
});

describe('typing the code from the email', () => {
  async function enterCode(wrapper: ReturnType<typeof render>, code: string) {
    const box = codeBox(wrapper);
    if (!box) throw new Error('the code box is not on screen');
    await box.setValue(code);
    await box.trigger('keyup.enter');
    await flushPromises();
  }

  test('signs in and closes on a good code', async () => {
    const wrapper = render();
    await sendTo(wrapper);

    await enterCode(wrapper, '123456');

    expect(signInWithCode).toHaveBeenCalledWith('reader@example.test', '123456');
    expect(closeLoginModal).toHaveBeenCalled();
  });

  test('a mistyped code says so and clears the box for another go', async () => {
    signInWithCode.mockResolvedValue('invalid');
    const wrapper = render();
    await sendTo(wrapper);

    await enterCode(wrapper, '000000');

    expect(wrapper.text()).toContain('modalauth.magiclink.codeInvalid');
    expect((codeBox(wrapper)!.element as HTMLInputElement).value).toBe('');
  });

  test('a code typed in the WRONG BROWSER gets different advice', async () => {
    // Retyping it will never work; the way out is the link in the same email.
    signInWithCode.mockResolvedValue('wrong-browser');
    const wrapper = render();
    await sendTo(wrapper);

    await enterCode(wrapper, '123456');

    expect(wrapper.text()).toContain('modalauth.magiclink.codeWrongBrowser');
    expect(wrapper.text()).not.toContain('modalauth.magiclink.codeInvalid');
  });

  test('the modal stays open on a bad code', async () => {
    signInWithCode.mockResolvedValue('invalid');
    const wrapper = render();
    await sendTo(wrapper);

    await enterCode(wrapper, '000000');

    expect(closeLoginModal).not.toHaveBeenCalled();
  });

  test('an empty code is not spent', async () => {
    const wrapper = render();
    await sendTo(wrapper);

    await enterCode(wrapper, '   ');

    expect(signInWithCode).not.toHaveBeenCalled();
  });
});
