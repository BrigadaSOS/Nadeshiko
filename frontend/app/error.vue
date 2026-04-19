<script setup lang="ts">
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();
const { t } = useI18n();
const localePath = useLocalePath();

const is404 = computed(() => props.error.statusCode === 404);

const pageTitle = computed(() => {
  const msg = is404.value ? t('errorPage.pageNotFound') : t('errorPage.somethingWentWrong');
  return `${msg} | Nadeshiko`;
});

useHead({
  title: pageTitle,
  meta: [
    { name: 'description', content: 'The page you are looking for could not be found.' },
    { name: 'robots', content: 'noindex' },
  ],
});

const handleError = () => clearError({ redirect: localePath('/') });
</script>

<template>
  <NuxtLayout>
    <div class="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div class="flex flex-col items-center max-w-lg mx-auto text-center">
        <img
          data-testid="error-image"
          class="mb-6"
          src="/assets/no-results.gif"
          alt="Not found"
        >
        <h2 data-testid="error-status-code" class="font-bold text-red-400 text-3xl">
          {{ error.statusCode }}
        </h2>
        <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">
          {{ is404 ? t('errorPage.pageNotFound') : t('errorPage.somethingWentWrong') }}
        </h1>
        <a
          href="/"
          class="mt-4 text-lg text-red-400 hover:text-red-300 transition-colors"
          @click.prevent="handleError"
        >
          {{ t('errorPage.goHome') }}
        </a>
      </div>
    </div>
  </NuxtLayout>
</template>
