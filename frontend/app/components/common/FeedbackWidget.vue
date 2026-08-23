<script setup lang="ts">
import { mdiClose } from '@mdi/js';
import { posthog } from '~/utils/posthogClient';
import { DISCORD_INVITE_URL } from '#shared/utils/socialLinks';
import { userStore } from '~/stores/auth';
import { handleApiError } from '~/utils/apiError';

/**
 * The feedback panel.
 *
 * Rendered once in the default layout; opened from the floating button in
 * `CommonFabDock`, the navigation drawer, and the footer. Anyone can send —
 * signed in or not — so the panel asks for an email only when there is no
 * account to take one from.
 *
 * The submission is protected by an issue-time token the backend hands out when
 * the panel opens (see `feedbackController`). Fetching it here rather than
 * rendering it into the page is what lets the page itself stay cacheable at the
 * edge: a token baked into the HTML would be shared by every visitor served that
 * copy, and stale by an unbounded amount.
 */

const { t, locale } = useI18n();
const route = useRoute();
const config = useRuntimeConfig();
const user = userStore();
const { isFeedbackOpen, closeFeedback } = useFeedbackWidget();

const MAX_BODY = 4000;
/** Long enough for the thanks state to be read, short enough not to feel stuck. */
const CLOSE_AFTER_MS = 2600;

const message = ref('');
const email = ref('');
/** Honeypot. Never shown, never filled by a person, so anything in it is a bot. */
const nickname = ref('');
const formToken = ref('');
const isSubmitting = ref(false);
const sent = ref(false);
const errorMessage = ref('');
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const canSubmit = computed(() => message.value.trim().length > 0 && !isSubmitting.value);

async function fetchFormToken() {
  try {
    const { token } = await useNadeshikoSdk().getFeedbackFormToken();
    formToken.value = token;
  } catch (error) {
    // Not surfaced here: the panel has only just opened and there is nothing for
    // the reader to do about it yet. Submitting without one is what reports it.
    handleApiError('feedback:token-failed', error, { toastKey: false });
    formToken.value = '';
  }
}

function resetForm() {
  message.value = '';
  nickname.value = '';
  errorMessage.value = '';
  sent.value = false;
}

function onClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  closeFeedback();
}

watch(isFeedbackOpen, (open) => {
  if (!open) return;
  // A panel reopened after a send starts blank; one reopened after an abandoned
  // draft keeps what was typed, which is the behaviour people expect of a box
  // they closed by accident.
  if (sent.value) resetForm();
  if (!formToken.value) fetchFormToken();
});

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});

async function submit() {
  if (!canSubmit.value) return;

  // No token means the issuing call failed. Say so and try again in the
  // background: a token minted right now would be younger than the minimum fill
  // time and the submission would be dropped as automated — silently, which is
  // the one outcome worth going out of the way to avoid.
  if (!formToken.value) {
    errorMessage.value = t('feedback.errorRetry');
    fetchFormToken();
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    await useNadeshikoSdk().createFeedback({
      body: message.value.trim(),
      formToken: formToken.value,
      // Sent even though it is empty, because the field being present is what
      // makes it a honeypot: a bot that fills every input it finds trips it.
      nickname: nickname.value || undefined,
      email: user.isLoggedIn ? undefined : email.value.trim() || undefined,
      pagePath: route.fullPath,
      // The locale the page is rendering in, not the browser's preference: the
      // site takes it from the URL prefix and a stored setting, so a reader on
      // /es with an English browser is reading Spanish.
      locale: locale.value,
      appVersion: String(config.public.appVersion || ''),
      ...analyticsIds(),
    });

    sent.value = true;
    // The token is spent. Drop it so the next open fetches a fresh one rather
    // than reusing one whose age no longer describes this form.
    formToken.value = '';
    closeTimer = setTimeout(onClose, CLOSE_AFTER_MS);
  } catch (error) {
    // Rendered inline, inside the panel that still holds what they wrote.
    const known = handleApiError('feedback:submit-failed', error, { toastKey: false });
    errorMessage.value = known?.status === 429 ? t('feedback.errorRateLimited') : t('feedback.error');
  } finally {
    isSubmitting.value = false;
  }
}

/**
 * The sender's PostHog ids, read at submit so a report links to their session
 * replay. Absent wherever posthog is not loaded, which includes local dev.
 *
 * `__loaded` and not `isAnalyticsEnabled()`, unlike every other call site: these
 * are reads, and a read is the one thing the pre-load stub cannot defer -- there
 * is no session id to give until the SDK has made one. A submission in that
 * window travels without ids rather than with wrong ones, which is what it did
 * before this was deferred too.
 */
function analyticsIds(): { posthogSessionId?: string; posthogDistinctId?: string } {
  if (!posthog.__loaded) return {};
  return {
    posthogSessionId: posthog.get_session_id?.() || undefined,
    posthogDistinctId: posthog.get_distinct_id?.() || undefined,
  };
}
</script>

<template>
  <CommonBaseModal
      data-testid="feedback-modal"
      :open="isFeedbackOpen"
      labelledby="nd-feedback-title"
      overlay-class="items-end justify-center sm:items-center bg-neutral-900/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="onClose"
    >
      <div class="nd-modal-header">
        <h3 id="nd-feedback-title" class="font-bold text-gray-800 dark:text-white">
          {{ t('feedback.title') }}
        </h3>
        <button
          type="button"
          class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400"
          @click="onClose"
        >
          <span class="sr-only">{{ t('feedback.close') }}</span>
          <UiBaseIcon :path="mdiClose" :size="18" />
        </button>
      </div>

      <!-- Thanks state. Replaces the form rather than sitting beside it, so the
           panel does not grow a second screen's worth of height on send. -->
      <div v-if="sent" class="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <div class="text-4xl leading-none" aria-hidden="true">🙏</div>
        <p class="text-base font-semibold text-ink">{{ t('feedback.successTitle') }}</p>
        <p class="text-sm text-ink-muted">{{ t('feedback.successBody') }}</p>
      </div>

      <form v-else class="flex flex-col gap-4 p-4" @submit.prevent="submit">
        <!-- The invite rides along in the same paragraph: it is the other door,
             for what is a conversation rather than a message into a box, not a
             second instruction to read. -->
        <p class="text-sm text-ink-muted">
          {{ t('feedback.subtitle') }}
          <i18n-t keypath="feedback.discord" tag="span" scope="global">
            <template #link>
              <a
                :href="DISCORD_INVITE_URL"
                target="_blank"
                rel="noopener"
                class="underline underline-offset-2 hover:text-ink"
              >{{ t('feedback.discordLink') }}</a>
            </template>
          </i18n-t>
        </p>

        <div
          v-if="errorMessage"
          class="p-3 text-sm text-red-400 bg-red-900/20 border border-red-700 rounded-lg"
          role="alert"
        >
          {{ errorMessage }}
        </div>

        <!-- Honeypot: off-screen for people, tempting to anything filling in
             every field it can find. `aria-hidden` and `tabindex` keep it away
             from screen readers and the tab order alike. -->
        <div class="sr-only" aria-hidden="true">
          <label for="nd-feedback-nickname">Leave this field empty</label>
          <input id="nd-feedback-nickname" v-model="nickname" type="text" tabindex="-1" autocomplete="off" />
        </div>

        <textarea
          v-model="message"
          data-autofocus
          rows="4"
          required
          :maxlength="MAX_BODY"
          :placeholder="t('feedback.bodyPlaceholder')"
          :aria-label="t('feedback.bodyLabel')"
          class="nd-input min-h-24 text-sm"
        />

        <label v-if="!user.isLoggedIn" class="flex flex-col gap-1.5">
          <span class="text-sm font-medium text-ink">
            {{ t('feedback.emailLabel') }}
            <span class="ms-1 font-normal text-ink-muted">{{ t('feedback.emailOptional') }}</span>
          </span>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            :placeholder="t('feedback.emailPlaceholder')"
            class="nd-input text-sm"
          />
          <span class="text-xs text-ink-muted">{{ t('feedback.emailHint') }}</span>
        </label>

        <div class="flex justify-end">
          <button type="submit" :disabled="!canSubmit" class="nd-btn-accent">
            <span v-if="isSubmitting" class="nd-spinner" />
            {{ isSubmitting ? t('feedback.submitting') : t('feedback.submit') }}
          </button>
        </div>
      </form>
  </CommonBaseModal>
</template>
