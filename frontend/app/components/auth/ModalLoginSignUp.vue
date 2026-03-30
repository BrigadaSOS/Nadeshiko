<script setup lang="ts">
import { mdiGoogle } from '@mdi/js';

const store = userStore();
const { $i18n } = useNuxtApp();
const magicLinkEmail = ref('');
const magicLinkSent = ref(false);
const magicLinkLoading = ref(false);

watch(
  () => store.isLoggedIn,
  async (newVal) => {
    if (newVal) {
      await nextTick();
      window.NDOverlay?.close('#nd-vertically-centered-scrollable-loginsignup-modal');
    }
  },
);

const handleGoogleLogin = async () => {
  await store.loginGoogle();
};

const handleDiscordLogin = async () => {
  await store.loginDiscord();
};

const handleMagicLink = async () => {
  if (!magicLinkEmail.value.trim()) return;
  magicLinkLoading.value = true;
  const sent = await store.sendMagicLink(magicLinkEmail.value.trim());
  magicLinkLoading.value = false;
  if (sent) {
    magicLinkSent.value = true;
  } else {
    useToastError($i18n.t('modalauth.labels.errorlogin400'));
  }
};

function resetMagicLinkState() {
  magicLinkSent.value = false;
  magicLinkEmail.value = '';
}

onMounted(() => {
  const modal = document.getElementById('nd-vertically-centered-scrollable-loginsignup-modal');
  if (!modal) return;
  const observer = new MutationObserver(() => {
    if (modal.classList.contains('hidden')) {
      resetMagicLinkState();
    }
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  onUnmounted(() => observer.disconnect());
});
</script>

<template>
  <div
    id="nd-vertically-centered-scrollable-loginsignup-modal"
    class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="justify-center nd-overlay-open:opacity-100 nd-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-2xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div class="max-h-full flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border w-full">
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
          <h3 class="font-bold text-gray-600 dark:text-gray-300">{{ $t('modalauth.headers.auth') }}</h3>
          <button
            type="button"
            class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400"
            data-nd-overlay="#nd-vertically-centered-scrollable-loginsignup-modal"
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
          <UiButtonPrimaryAction
            @click="handleGoogleLogin"
            class="py-3 w-full px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2"
          >
            <UiBaseIcon :path="mdiGoogle" size="20" />
            {{ $t('modalauth.buttons.google') }}
          </UiButtonPrimaryAction>

          <UiButtonPrimaryAction
            @click="handleDiscordLogin"
            class="py-3 w-full px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="inline-block">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            {{ $t('modalauth.buttons.discord') }}
          </UiButtonPrimaryAction>

          <div class="pt-4 border-t border-white/10 mt-4 space-y-2">
            <p class="text-sm text-gray-400">{{ $t('modalauth.magiclink.label') }}</p>
            <div v-if="!magicLinkSent" class="flex gap-2">
              <input
                v-model="magicLinkEmail"
                type="email"
                :disabled="magicLinkLoading"
                :placeholder="$t('modalauth.magiclink.placeholder')"
                class="block p-2.5 flex-1 text-sm text-gray-900 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-input-focus-ring dark:bg-modal-input dark:border-white/5 dark:text-gray-300 disabled:opacity-50"
                @keyup.enter="handleMagicLink"
              />
              <UiButtonPrimaryAction
                :disabled="magicLinkLoading"
                @click="handleMagicLink"
                class="py-2 px-4 inline-flex justify-center items-center gap-2 rounded-md border border-transparent font-semibold bg-sgray text-white hover:bg-sgray2 disabled:opacity-50"
              >
                {{ $t('modalauth.magiclink.send') }}
              </UiButtonPrimaryAction>
            </div>
            <p v-else class="text-sm text-green-400">
              {{ $t('modalauth.magiclink.sent') }}
              <button class="ml-2 underline text-gray-400 hover:text-gray-300" @click="magicLinkSent = false">{{ $t('modalauth.magiclink.retry') }}</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
