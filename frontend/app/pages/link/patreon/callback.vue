<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();
const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  const error = String(route.query.error ?? '');
  if (error || !code || !sealed) {
    state.value = 'failed';
    message.value = error === 'access_denied' ? t('roadmap.callbackDeclined') : t('roadmap.callbackFailed');
    return;
  }
  try {
    await $fetch('/v1/user/connections/patreon/callback', { method: 'POST', body: { code, state: sealed } });
    await router.replace({ path: route.path, query: {} });
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    message.value = t('roadmap.callbackFailed');
    handleApiError('patreonConnection.callback', caught, { toastKey: false });
  }
});
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center text-white" data-testid="patreon-callback">
    <span v-if="state === 'working'" class="nd-spinner" />
    <template v-else-if="state === 'done'">
      <div class="flex size-16 items-center justify-center rounded-full bg-green-500/15 text-green-300"><UiBaseIcon :path="mdiCheckBold" size="30" /></div>
      <h1 class="mt-5 text-3xl font-bold">{{ t('roadmap.callbackDone') }}</h1>
      <p class="mt-2 text-white/50">{{ t('roadmap.callbackDoneBody') }}</p>
      <NuxtLink :to="localePath('/roadmap#propose')" class="nd-btn-accent mt-6">{{ t('roadmap.backToRoadmap') }}</NuxtLink>
    </template>
    <template v-else>
      <h1 class="text-3xl font-bold">{{ message }}</h1>
      <NuxtLink :to="localePath('/roadmap#propose')" class="mt-5 text-red-300 hover:text-red-200">{{ t('roadmap.backToRoadmap') }}</NuxtLink>
    </template>
  </div>
</template>
