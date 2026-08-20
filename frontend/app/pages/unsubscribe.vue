<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { useRoute } from 'vue-router';
import { handleApiError } from '~/utils/apiError';

/**
 * Where the unsubscribe link in a lifecycle email lands.
 *
 * IT CONFIRMS BEFORE IT ACTS, and that is the whole reason this page exists
 * rather than a backend route the link could point straight at. Mail scanners
 * and link-preview bots fetch every URL in a message before the recipient has
 * seen it; anything that opted somebody out on arrival would unsubscribe readers
 * from mail they never opened, and we would never know it had happened.
 *
 * So the GET renders a button and changes nothing. The POST behind that button
 * is the same endpoint Gmail's one-click unsubscribe posts to directly -- see
 * `unsubscribeUrls` in the backend for why the header and this page are two
 * different URLs carrying the same token.
 *
 * No session required, by design. The token speaks for the account, and an
 * opt-out that first demanded a sign-in is the one that gets answered with the
 * spam button instead.
 */

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const token = computed(() => String(route.query.token ?? ''));
const state = ref<'ready' | 'working' | 'done' | 'failed'>('ready');
const message = ref('');

// Nothing here should be indexed or previewed: the URL carries a token, and a
// crawler following it is exactly the visitor this page is careful about.
definePageMeta({ robots: false });

const confirm = async () => {
  if (state.value === 'working') return;

  if (!token.value) {
    state.value = 'failed';
    message.value = t('unsubscribe.invalid');
    return;
  }

  state.value = 'working';
  try {
    await useNadeshikoSdk().unsubscribeFromEmail({ token: token.value });
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    // A token we cannot read is the one failure the reader can route around
    // themselves, so it names the way out rather than saying "something went
    // wrong": the same switch lives in their settings.
    const status =
      (caught as { status?: number; response?: { status?: number } })?.status ??
      (caught as { response?: { status?: number } })?.response?.status;
    message.value = status === 400 ? t('unsubscribe.invalid') : t('unsubscribe.failed');
    handleApiError('email.unsubscribe', caught, { toastKey: false });
  }
};
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4">
    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
      <template v-if="state === 'done'">
        <h1 class="flex items-center gap-2 text-2xl font-semibold text-white md:text-3xl">
          <UiBaseIcon :path="mdiCheckBold" size="22" class="text-green-400" />
          <span>{{ t('unsubscribe.done') }}</span>
        </h1>
        <!-- Says plainly that sign-in mail keeps working. Otherwise the reader is
             left wondering whether they have just broken their own account, and
             the ones who assume they have will write in to ask. -->
        <p class="mt-2 text-gray-400">{{ t('unsubscribe.doneDetail') }}</p>
        <NuxtLink :to="localePath('/user/settings')" class="nd-btn-accent mt-6">
          {{ t('unsubscribe.goToSettings') }}
        </NuxtLink>
      </template>

      <template v-else-if="state === 'failed'">
        <img data-testid="error-image" class="mb-6" src="/assets/no-results.gif" :alt="t('errorPage.imageAlt')">
        <h1 class="text-2xl font-semibold text-white md:text-3xl">{{ message }}</h1>
        <NuxtLink :to="localePath('/user/settings')" class="mt-4 text-lg text-red-400 hover:text-red-300 transition-colors">
          {{ t('unsubscribe.goToSettings') }}
        </NuxtLink>
      </template>

      <template v-else>
        <h1 class="text-2xl font-semibold text-white md:text-3xl">{{ t('unsubscribe.title') }}</h1>
        <p class="mt-2 text-gray-400">{{ t('unsubscribe.detail') }}</p>
        <button type="button" class="nd-btn-accent mt-6" :disabled="state === 'working'" @click="confirm">
          <span v-if="state === 'working'" class="nd-spinner" aria-hidden="true" />
          <span v-else>{{ t('unsubscribe.confirm') }}</span>
        </button>
        <NuxtLink :to="localePath('/')" class="mt-4 text-sm text-gray-400 hover:text-gray-300 transition-colors">
          {{ t('unsubscribe.cancel') }}
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
