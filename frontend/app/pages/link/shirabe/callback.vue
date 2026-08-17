<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { useRoute } from 'vue-router';
import { handleApiError } from '~/utils/apiError';

/**
 * Where Shirabe sends the reader back after they approve.
 *
 * This URL is registered over there and exact-matched, so it is a fixed address
 * rather than something to build per environment. It exists as a PAGE rather
 * than as a backend route so the reader lands on something of ours that can say
 * what is happening and where they are going next: a redirect straight into an
 * API would have answered them with JSON.
 *
 * The code is handed straight to the backend and never kept: it is one-time,
 * two minutes old, and the exchange needs a PKCE verifier only the backend has.
 */

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');
const shirabeName = ref('');

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  // Shirabe reports a refusal on the redirect, the way the spec says. The
  // ordinary one is `access_denied`: the reader looked at the consent screen and
  // said no, which is an answer rather than a failure.
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
    // Says so and stops, rather than redirecting to settings on its own. A
    // redirect here spends the one moment the reader is looking for an answer:
    // they approved something on another site, came back, and the page they
    // asked for flashes past into a settings page that looks the same as before.
    // Whether it worked is the only thing they came back to find out.
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    message.value = t('connections.callback.failed');
    handleApiError('shirabeConnection.callback', caught);
  }
});
</script>

<template>
  <!-- Three outcomes, all of them said out loud on this page rather than
       forwarded on. The failure borrows app/error.vue's shape, gif and all: a
       connect that does not connect leaves the reader at a dead end on a page
       they have never seen before, and the site already has a way of looking
       sorry about that. -->
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4">
    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
      <template v-if="state === 'working'">
        <span class="nd-spinner" aria-hidden="true" />
        <p class="mt-4 text-gray-400">{{ t('connections.callback.working') }}</p>
      </template>

      <template v-else-if="state === 'done'">
        <img src="/assets/shirabe-logo.png" alt="" aria-hidden="true" width="96" height="96" class="w-24 h-24 mb-5">
        <h1 class="flex items-center gap-2 text-2xl font-semibold text-white md:text-3xl">
          <UiBaseIcon :path="mdiCheckBold" size="22" class="text-green-400" />
          <span>{{ t('connections.callback.done') }}</span>
        </h1>
        <p class="mt-2 text-gray-400">{{ t('connections.shirabe.linkedAs', { name: shirabeName }) }}</p>
        <NuxtLink :to="localePath('/user/settings')" class="nd-btn-accent mt-6">
          {{ t('connections.callback.goToSettings') }}
        </NuxtLink>
      </template>

      <template v-else>
        <img data-testid="error-image" class="mb-6" src="/assets/no-results.gif" :alt="t('errorPage.imageAlt')">
        <h1 class="text-2xl font-semibold text-white md:text-3xl">{{ message }}</h1>
        <NuxtLink
          :to="localePath('/user/settings')"
          class="mt-4 text-lg text-red-400 hover:text-red-300 transition-colors"
        >
          {{ t('connections.callback.back') }}
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
