<script setup lang="ts">
const { t } = useI18n();
useHead({
  title: () => t('modalauth.signingIn'),
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
});
</script>

<template>
  <main class="flex min-h-screen items-center justify-center" aria-live="polite">
    <p>{{ t('modalauth.completingSignIn') }}</p>
  </main>
</template>
