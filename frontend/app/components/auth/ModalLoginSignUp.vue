<script setup lang="ts">
import { mdiBookmarkMultipleOutline, mdiFileDocumentPlusOutline, mdiHistory } from '@mdi/js';

/**
 * Why an account is worth making, in the order a reader meets the features.
 *
 * `mdiFileDocumentPlusOutline` is deliberately the same mark the segment menu,
 * the word card and the download nudge already use for Anki, so somebody who met
 * the greyed-out menu entry recognises what is being offered rather than reading
 * it as a new thing.
 */
const accountBenefits = [
  { key: 'anki', icon: mdiFileDocumentPlusOutline },
  { key: 'collections', icon: mdiBookmarkMultipleOutline },
  { key: 'sync', icon: mdiHistory },
] as const;
import { type AuthProvider, authIntentStorage, updateAuthIntent } from '~/utils/authAnalytics';

const store = userStore();
const { $i18n } = useNuxtApp();
const posthog = usePostHog();
const magicLinkEmail = ref('');
const magicLinkSent = ref(false);
const magicLinkLoading = ref(false);
const loginCode = ref('');
const codeLoading = ref(false);
const codeError = ref('');
const magicLinkSends = ref(0);
const resendIn = ref(0);
const magicLinkError = ref('');
let resendTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Counts the hold-back down once a second and stops at zero.
 *
 * Cleared before starting so a second send cannot leave two intervals running
 * against one counter, which reads as the clock ticking twice as fast.
 */
function startResendCountdown(seconds: number) {
  stopResendCountdown();
  resendIn.value = Math.max(0, Math.ceil(seconds));
  if (resendIn.value === 0) return;

  resendTimer = setInterval(() => {
    resendIn.value -= 1;
    if (resendIn.value <= 0) stopResendCountdown();
  }, 1000);
}

function stopResendCountdown() {
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = null;
}

onUnmounted(stopResendCountdown);
const { isLoginModalOpen, closeLoginModal, loginModalSource } = useLoginModal();

/**
 * Records the provider against the gate the modal was opened from, and parks it
 * where the far side of the redirect can read it.
 *
 * Google and Discord leave the page entirely, and a magic link comes back in a
 * different tab, so anything held in memory here is gone by the time the account
 * exists -- which is exactly why `signup_completed` used to report
 * `provider: 'unknown'` even when it did fire.
 */
function beginLogin(provider: AuthProvider) {
  const source = loginModalSource.value;
  const gate = source === 'header' || source === 'unknown' ? undefined : source;

  updateAuthIntent(authIntentStorage(), { provider, source, gate }, Date.now());
  posthog?.capture('login_initiated', { provider, source, gate: gate ?? null });
}

watch(
  () => store.isLoggedIn,
  async (newVal) => {
    if (newVal) {
      await nextTick();
      closeLoginModal();
    }
  },
);

const handleGoogleLogin = async () => {
  beginLogin('google');
  await store.loginGoogle();
};

const handleDiscordLogin = async () => {
  beginLogin('discord');
  await store.loginDiscord();
};

const handleMagicLink = async () => {
  if (!magicLinkEmail.value.trim() || magicLinkLoading.value || resendIn.value > 0) return;
  beginLogin('magic_link');
  magicLinkLoading.value = true;
  magicLinkError.value = '';
  const outcome = await store.sendMagicLink(magicLinkEmail.value.trim());
  magicLinkLoading.value = false;

  if (outcome.status === 'ok') {
    magicLinkSent.value = true;
    magicLinkSends.value += 1;
    // Each send waits longer than the last; asking again while one is pending is
    // a resend by definition.
    startResendCountdown(holdBackFor(magicLinkSends.value));
    posthog?.capture('magic_link_requested');
    return;
  }

  if (outcome.status === 'rate-limited') {
    // Not a failure to apologise for — they have had their five this hour, and
    // the server said when they may ask again. Stay on the sent view so the code
    // field remains usable: a link they already have still works.
    magicLinkSent.value = true;
    magicLinkError.value = $i18n.t('modalauth.magiclink.rateLimited');
    startResendCountdown(outcome.retryAfterSeconds);
    return;
  }

  useToastError($i18n.t('modalauth.labels.errorlogin400'));
};

/**
 * Spend the typed code.
 *
 * `wrong-browser` is its own outcome rather than a generic failure because the
 * two need different advice: a mistyped code is worth another go, a code typed
 * into a browser that never asked for it never will be, and the way out is the
 * link in the same email.
 */
const handleLoginCode = async () => {
  const code = loginCode.value.trim();
  if (!code || codeLoading.value) return;

  codeLoading.value = true;
  codeError.value = '';
  const outcome = await store.signInWithCode(magicLinkEmail.value.trim(), code);
  codeLoading.value = false;

  if (outcome === 'ok') {
    posthog?.capture('login_code_used');
    resetMagicLinkState();
    closeLoginModal();
    useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
    return;
  }

  codeError.value = $i18n.t(
    outcome === 'wrong-browser' ? 'modalauth.magiclink.codeWrongBrowser' : 'modalauth.magiclink.codeInvalid',
  );
  loginCode.value = '';
};

/** "Try a different email" — drops this browser's attempt, not the mail already sent. */
const resetMagicLink = () => {
  magicLinkSent.value = false;
  loginCode.value = '';
  codeError.value = '';
  magicLinkError.value = '';
};

function resetMagicLinkState() {
  magicLinkSent.value = false;
  magicLinkEmail.value = '';
  loginCode.value = '';
  codeError.value = '';
  magicLinkError.value = '';
  magicLinkSends.value = 0;
  stopResendCountdown();
}

watch(isLoginModalOpen, (open) => {
  if (!open) resetMagicLinkState();
});
</script>

<template>
  <CommonBaseModal
    data-testid="login-modal"
    :open="isLoginModalOpen"
    overlay-class="items-center justify-center bg-neutral-900/40"
    panel-class="max-h-[calc(100%-3.5rem)] flex flex-col bg-background border border-hairline shadow-sm rounded-xl w-full lg:max-w-2xl m-3 sm:mx-auto"
    labelledby="nd-login-modal-title"
    @close="closeLoginModal"
  >
        <div class="nd-modal-header">
          <h3 id="nd-login-modal-title" class="font-bold text-gray-600 dark:text-gray-300">{{ $t('modalauth.headers.auth') }}</h3>
          <button
            type="button"
            class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400"
            @click="closeLoginModal"
          >
            <span class="sr-only">{{ $t('modalauth.labels.closeSrOnly') }}</span>
            <svg class="w-3.5 h-3.5" width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-3">
          <!-- What the account is FOR, before the buttons that create one.
               The modal used to open on three sign-in methods and no reason to
               use any of them -- which is a fair thing to ask of somebody who
               reached it from the header, and no answer at all for the reader
               the nudges send here. These three are the features an account
               actually adds; everything else on the site already works signed
               out. -->
          <ul class="space-y-2.5 pb-1">
            <li v-for="benefit in accountBenefits" :key="benefit.key" class="flex items-start gap-2.5">
              <UiBaseIcon
                :path="benefit.icon"
                :size="18"
                w="w-[18px]"
                h="h-[18px]"
                class="mt-0.5 shrink-0 text-red-400"
                aria-hidden="true"
              />
              <span class="text-sm leading-snug text-gray-300">{{ $t(`modalauth.benefits.${benefit.key}`) }}</span>
            </li>
          </ul>

          <button
            type="button"
            @click="handleGoogleLogin"
            class="py-3 w-full px-4 inline-flex justify-center items-center gap-2 rounded-md font-semibold bg-white text-[#1f1f1f] hover:bg-neutral-100"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {{ $t('modalauth.buttons.google') }}
          </button>

          <button
            type="button"
            @click="handleDiscordLogin"
            class="py-3 w-full px-4 inline-flex justify-center items-center gap-2 rounded-md font-semibold bg-[#5865F2] text-white hover:bg-[#4752C4]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            {{ $t('modalauth.buttons.discord') }}
          </button>

          <div class="pt-4 border-t border-hairline mt-4 space-y-2">
            <p class="text-sm text-gray-400">{{ $t('modalauth.magiclink.label') }}</p>
            <div v-if="!magicLinkSent" class="flex gap-2">
              <input
                v-model="magicLinkEmail"
                type="email"
                :disabled="magicLinkLoading"
                :placeholder="$t('modalauth.magiclink.placeholder')"
                class="nd-input flex-1 disabled:opacity-50"
                @keyup.enter="handleMagicLink"
              />
              <!-- The spinner is not decoration here. The send is synchronous
                   all the way through an SMTP handshake to Japan, so this button
                   sits for four to six seconds; without a spinner the reader
                   gets no acknowledgement at all and presses it again. -->
              <UiButtonPrimaryAction
                :disabled="magicLinkLoading"
                @click="handleMagicLink"
                class="py-2 px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-surface text-ink hover:bg-surface-hover disabled:opacity-50"
              >
                <span v-if="magicLinkLoading" class="nd-spinner" aria-hidden="true" />
                <span>{{ $t(magicLinkLoading ? 'modalauth.magiclink.sending' : 'modalauth.magiclink.send') }}</span>
              </UiButtonPrimaryAction>
            </div>
            <div v-else class="space-y-3">
              <!-- Names the address it went to, then says what to do next. The
                   old copy said only "check your email", which left the code
                   field below it looking like something you might have to fill
                   in as well as opening the link. -->
              <p class="text-sm text-green-400">{{ $t('modalauth.magiclink.sent', { email: magicLinkEmail }) }}</p>
              <p class="text-sm text-gray-400">{{ $t('modalauth.magiclink.sentHint') }}</p>

              <!-- The code is the second way in, for when the mail is on a phone
                   and the session is wanted here. It only works in this browser:
                   the backend refuses a code without a matching claim, which is
                   what keeps six characters safe to read aloud. -->
              <div class="flex gap-2">
                <input
                  v-model="loginCode"
                  type="text"
                  inputmode="text"
                  autocomplete="one-time-code"
                  autocapitalize="characters"
                  spellcheck="false"
                  maxlength="9"
                  :disabled="codeLoading"
                  :placeholder="$t('modalauth.magiclink.codePlaceholder')"
                  :aria-label="$t('modalauth.magiclink.codeLabel')"
                  class="nd-input flex-1 text-center font-mono tracking-[0.3em] uppercase disabled:opacity-50"
                  @keyup.enter="handleLoginCode"
                />
                <UiButtonPrimaryAction
                  :disabled="codeLoading || !loginCode.trim()"
                  @click="handleLoginCode"
                  class="py-2 px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-surface text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                  {{ $t('modalauth.magiclink.codeSubmit') }}
                </UiButtonPrimaryAction>
              </div>

              <p v-if="codeError" class="text-sm text-red-300">{{ codeError }}</p>
              <p v-if="magicLinkError" class="text-sm text-amber-300">{{ magicLinkError }}</p>

              <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <!-- The wait is shown rather than the button being merely dead,
                     because a disabled control with no reason attached reads as
                     broken. Counting down also tells somebody whose mail is slow
                     that waiting is the right thing to do. -->
                <span v-if="resendIn > 0" class="text-gray-400">
                  {{ $t('modalauth.magiclink.resendIn', { seconds: resendIn }) }}
                </span>
                <button
                  v-else
                  class="underline text-gray-400 hover:text-gray-300"
                  :disabled="magicLinkLoading"
                  @click="handleMagicLink"
                >
                  {{ $t('modalauth.magiclink.resend') }}
                </button>
                <button class="underline text-gray-400 hover:text-gray-300" @click="resetMagicLink">
                  {{ $t('modalauth.magiclink.retry') }}
                </button>
              </p>
            </div>
          </div>
        </div>
  </CommonBaseModal>
</template>
