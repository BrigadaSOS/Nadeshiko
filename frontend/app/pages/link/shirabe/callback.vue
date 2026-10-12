<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { useRoute, useRouter } from 'vue-router';
import { handleApiError } from '~/utils/apiError';

// Shirabe exact-matches this fixed callback URL. A page shows progress instead of API JSON.
// Forward the one-time, two-minute code immediately; only the backend holds the PKCE verifier.

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');
const shirabeName = ref('');

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  // access_denied is declined consent, not an exchange failure.
  const error = String(route.query.error ?? '');

  if (error || !code || !sealed) {
    state.value = 'failed';
    message.value = error === 'access_denied' ? t('connections.callback.declined') : t('connections.callback.failed');
    return;
  }

  try {
    const { connection } = await $fetch<{ connection: { shirabeName: string | null } }>(
      '/v1/user/connections/shirabe/callback',
      { method: 'POST', body: { code, state: sealed } },
    );
    shirabeName.value = connection?.shirabeName || t('connections.shirabe.anonymous');
    // Clear spent credentials only on success: reload must not replay them,
    // but a failed exchange should remain retryable.
    await router.replace({ path: route.path, query: {} });
    // Keep the outcome visible instead of redirecting to an unchanged settings page.
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    // Name an expired/missing session so the reader knows to sign in again.
    const status =
      (caught as { status?: number; response?: { status?: number } })?.status ??
      (caught as { response?: { status?: number } })?.response?.status;
    message.value = status === 401 ? t('connections.callback.signedOut') : t('connections.callback.failed');
    handleApiError('shirabeConnection.callback', caught, { toastKey: false });
  }
});
</script>

<template>
  <!-- Show outcomes here; failures reuse the site's error-page presentation. -->
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4" data-testid="shirabe-callback">
    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
      <template v-if="state === 'working'">
        <span class="nd-spinner" aria-hidden="true" />
        <p data-testid="shirabe-callback-working" class="mt-4 text-gray-400">{{ t('connections.callback.working') }}</p>
      </template>

      <template v-else-if="state === 'done'">
        <div data-testid="shirabe-callback-success" class="flex flex-col items-center">
        <img src="/assets/shirabe-logo.png" alt="" aria-hidden="true" width="96" height="96" class="w-24 h-24 mb-5">
        <h1 class="flex items-center gap-2 text-2xl font-semibold text-white md:text-3xl">
          <UiBaseIcon :path="mdiCheckBold" size="22" class="text-green-400" />
          <span>{{ t('connections.callback.done') }}</span>
        </h1>
        <p data-testid="shirabe-linked-name" class="mt-2 text-gray-400">{{ t('connections.shirabe.linkedAs', { name: shirabeName }) }}</p>
        <NuxtLink :to="localePath('/user/settings')" class="nd-btn-accent mt-6">
          {{ t('connections.callback.goToSettings') }}
        </NuxtLink>
        </div>
      </template>

      <template v-else>
        <div data-testid="shirabe-callback-error" class="flex flex-col items-center">
        <img data-testid="error-image" class="mb-6" src="/assets/no-results.gif" :alt="t('errorPage.imageAlt')">
        <h1 data-testid="shirabe-callback-message" class="text-2xl font-semibold text-white md:text-3xl">{{ message }}</h1>
        <NuxtLink
          :to="localePath('/user/settings')"
          class="mt-4 text-lg text-red-400 hover:text-red-300 transition-colors"
        >
          {{ t('connections.callback.back') }}
        </NuxtLink>
        </div>
      </template>
    </div>
  </div>
</template>
